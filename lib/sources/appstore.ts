/**
 * Archived App Store listings.
 *
 * Each capture is 250–800KB of server-rendered state, and almost all of it is useful. Reading only
 * the rating count — as this source first did — throws away the rest of a page we have already paid
 * to download over a rate-limited connection. Everything below comes from bytes already in hand:
 *
 *   - `aggregateRating`      → the growth curve (PRD §13.1, verified against Wayback)
 *   - `versionHistory[]`     → every release, with an exact `releaseDate`
 *   - `name` / `description` → App Store title and copy changes, i.e. ASO work
 *   - `offers.price`         → monetization changes
 *
 * The version history matters most: PRD §7 recorded "App Store version history — no known free
 * endpoint", and this closes it without a single extra request.
 */

import type { Event, Metric } from "../schema.ts";
import type { Ctx } from "../fetcher.ts";
import type { Source, SourceResult } from "./registry.ts";

const CDX = "http://web.archive.org/cdx/search/cdx";

export const storeCdxUrl = (storeUrl: string) =>
  `${CDX}?url=${encodeURIComponent(storeUrl.replace(/^https?:\/\//, ""))}` +
  `&output=json&filter=statuscode:200&collapse=timestamp:6&fl=timestamp,original&limit=200`;

/** Raw bytes, for parsing. */
export const storeCaptureUrl = (ts: string, url: string) =>
  `http://web.archive.org/web/${ts}id_/${url}`;

/** Rewritten replay, for linking a human. `id_` renders unstyled and broken. */
export const storeViewUrl = (ts: string, url: string) =>
  `https://web.archive.org/web/${ts}/${url}`;

/** Archived store pages are large, so this caps bandwidth as much as time. */
const MAX_CAPTURES = 20;

export interface VersionRelease {
  version: string;
  date: string;
  /** First line of Apple's release notes — what actually shipped in this version. */
  notes?: string;
}

/** One purchasable thing: a subscription tier, or a one-off unlock. */
export interface Offer {
  /** Apple's SKU, stable across price changes — the key for detecting a reprice. */
  id: string;
  /** Subscription family, e.g. "HabitKit Pro". Absent for non-consumables. */
  label: string | null;
  price: number;
  currency: string;
  formatted: string;
  period: "week" | "month" | "year" | "lifetime" | null;
}

/**
 * How the app makes money, as a shape rather than a number.
 *
 * `freemium` (free download + in-app purchases) is the dominant indie model and the one a founder is
 * usually deciding between, so it is worth naming explicitly rather than leaving a reader to infer it
 * from a price of 0 plus a list of SKUs.
 */
export type Model = "free" | "freemium" | "paid" | "paid_plus_iap" | "unknown";

/**
 * `hasCatalogue` is what separates "free, no purchases" from "we could not read the purchases".
 *
 * Apple drops the embedded catalogue on newer page layouts, so zero offers is ambiguous. Without
 * this, HabitKit's last seven captures were labelled `free` for an app that has been freemium
 * throughout — wrong rather than absent, which is the failure this whole codebase is built to avoid.
 */
export function modelOf(price: number | undefined, offers: Offer[], hasCatalogue = true): Model {
  if (price === undefined) return "unknown";
  if (offers.length === 0 && !hasCatalogue) return "unknown";
  if (price > 0) return offers.length ? "paid_plus_iap" : "paid";
  return offers.length ? "freemium" : "free";
}

export interface StoreSnapshot {
  date: string;
  ts: string;
  original: string;
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  ratingCount?: number;
  ratingValue?: number;
  versions: VersionRelease[];
  offers: Offer[];
  model: Model;
}

/**
 * Read everything useful out of one capture.
 *
 * Two payloads, because Apple splits the data: JSON-LD carries the rating, name, description and
 * price; the serialized server-state blob carries `versionHistory`. Both are plain JSON in the
 * HTML — no DOM parsing, no browser (PRD §13.1).
 */
export function extractSnapshot(html: string, iosId: string): Omit<StoreSnapshot, "date" | "ts" | "original"> {
  const out: Omit<StoreSnapshot, "date" | "ts" | "original"> = { versions: [], offers: [], model: "unknown" };

  for (const m of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const d = JSON.parse(m[1]);
      if (!d?.aggregateRating) continue;
      if (typeof d.aggregateRating.reviewCount === "number") out.ratingCount = d.aggregateRating.reviewCount;
      if (typeof d.aggregateRating.ratingValue === "number") out.ratingValue = d.aggregateRating.ratingValue;
      if (typeof d.name === "string") out.name = d.name.trim();
      if (typeof d.description === "string") out.description = d.description.trim();
      if (d.offers && typeof d.offers.price === "number") out.price = d.offers.price;
      if (d.offers && typeof d.offers.priceCurrency === "string") out.currency = d.offers.priceCurrency;
      break;
    } catch {
      // Not every ld+json block is valid JSON; another may carry the rating.
    }
  }

  out.versions = extractVersions(html, iosId);
  out.offers = extractOffers(html, iosId);
  // The version history and the purchase catalogue live in the same embedded blob: if neither
  // parsed, the blob is absent and we know nothing about monetization.
  out.model = modelOf(out.price, out.offers, out.offers.length > 0 || out.versions.length > 0);
  return out;
}

/**
 * The billing period for an offer.
 *
 * **The SKU suffix wins over the scanned ISO duration.** `recurringSubscriptionPeriod` is read from a
 * fixed window after the offer, and that window can overlap the next offer — which made the same
 * `habitkit_3499_lt` read as `lifetime` in one capture and `month` in another. The suffix is encoded
 * in the SKU itself, so it cannot be captured from a neighbour.
 */
export function periodOf(iso: string | undefined, sku: string): Offer["period"] {
  if (/_lt$/i.test(sku)) return "lifetime";
  if (/_\d*w$/i.test(sku)) return "week";
  if (/_\d*m$/i.test(sku)) return "month";
  if (/_\d*y$/i.test(sku)) return "year";

  if (iso) {
    if (/W$/.test(iso)) return "week";
    if (/M$/.test(iso)) return "month";
    if (/Y$/.test(iso)) return "year";
  }
  return null;
}

/**
 * Collapse SKUs that a reader would see as the same product.
 *
 * An app often carries several SKUs at one price — a legacy family and its replacement — and listing
 * "HabitKit Pro $1.99/month" twice is noise. Change detection still runs on individual SKUs, because
 * a new SKU family at the same price really is a monetization move.
 */
export function summarizeOffers(offers: Offer[]): Offer[] {
  const seen = new Map<string, Offer>();
  for (const o of offers) {
    const key = `${o.period}:${o.price}:${o.currency}`;
    if (!seen.has(key)) seen.set(key, o);
  }
  return [...seen.values()].sort(
    (a, b) => ["week", "month", "year", "lifetime"].indexOf(a.period ?? "") -
              ["week", "month", "year", "lifetime"].indexOf(b.period ?? "") || a.price - b.price,
  );
}

/**
 * The in-app purchase catalogue — the actual pricing model.
 *
 * For a mobile app this matters far more than a pricing page, which most never have. Tiers, prices
 * and billing periods are all here, and because it appears in every archived capture it yields a
 * *dated history* of how the monetization changed.
 *
 * Scoped by `appAdamId`, for the same reason `extractVersions` is: the page carries the catalogue of
 * every app it links to, and mixing them in would invent a pricing history.
 */
export function extractOffers(html: string, iosId: string): Offer[] {
  const text = html.replace(/\\"/g, '"');
  const byId = new Map<string, Offer>();

  // Each buyParams blob names its app and its SKU; the display fields follow within the same offer
  // object. A fixed window rather than "up to the next buyParams": a subscription emits several
  // buyParams entries (base price, intro offers) and its display fields can sit past the next one.
  for (const m of text.matchAll(/"buyParams":"([^"]+)"/g)) {
    const params = m[1];
    const tail = text.slice(m.index! + m[0].length, m.index! + m[0].length + 900);
    if (!params.includes(`appAdamId=${iosId}`)) continue;

    const id = /offerName=([^&"\\]+)/.exec(params)?.[1];
    if (!id || byId.has(id)) continue;

    const formatted = /"priceFormatted":"([^"]+)"/.exec(tail)?.[1];
    const price = Number(/"price":([\d.]+)/.exec(tail)?.[1]);
    if (!formatted || !Number.isFinite(price)) continue;

    byId.set(id, {
      id,
      label: /"subscriptionFamilyName":"([^"]+)"/.exec(tail)?.[1] ?? null,
      price,
      currency: /"currencyCode":"([A-Z]{3})"/.exec(tail)?.[1] ?? "USD",
      formatted,
      period: periodOf(/"recurringSubscriptionPeriod":"([^"]+)"/.exec(tail)?.[1], id),
    });
  }

  return [...byId.values()].sort((a, b) => a.price - b.price);
}

/**
 * Pull the subject app's `versionHistory` out of the serialized state blob.
 *
 * **Scoping matters more than parsing here.** An App Store page embeds a `versionHistory` for every
 * app it links to — "You Might Also Like", "More by this developer" — sixteen of them on a typical
 * HabitKit capture. An unscoped scan happily returns versions 17.7 and 2025.10 from unrelated apps
 * and builds a confident, entirely fictional release timeline. Every block is therefore matched back
 * to the nearest preceding app id and kept only when that id is ours.
 *
 * Scanning rather than parsing the blob is deliberate: it arrives attribute-escaped inside a script
 * tag, its nesting has changed across Apple's redesigns, and the newest captures drop it entirely.
 * Scanning degrades to "no versions found" instead of throwing.
 */
/** Apple's boilerplate for a release with nothing to announce. Repeating it adds no information. */
const GENERIC_NOTES =
  /^(this (release|update|version) (includes|contains)|(important |minor )?bug ?fixes|performance|various|general improvements|stability|thank you|thanks for)/i;

/** The first sentence of a changelog entry — enough to say what shipped, not a reproduction of it. */
export function summarizeNotes(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw
    .replace(/\\+n/g, "\n")
    .split(/\n|(?<=[.!?])\s+/)
    // Strip list bullets and any trailing escape artefact the blob leaked.
    .map((s) => s.replace(/^[-•*\s]+/, "").replace(/\\+$/, "").trim())
    .find((s) => s.length > 12);
  if (!first || GENERIC_NOTES.test(first)) return undefined;
  // Anything that is only boilerplate with a word in front is still boilerplate.
  if (/^[\w\s]{0,20}(bug ?fixes|performance optimi[sz]ations?)\.?$/i.test(first)) return undefined;
  return first.length > 96 ? `${first.slice(0, 93)}…` : first;
}

export function extractVersions(html: string, iosId: string): VersionRelease[] {
  // Unescape once, as `extractOffers` does. The blob is attribute-escaped inside a script tag, so
  // raw quotes arrive as \" and any pattern written against them fights the escaping instead of
  // the data — which is why release notes silently never parsed.
  const text = html.replace(/\\"/g, '"');

  const found = new Map<string, { date: string; notes?: string }>();
  const idPattern = /(?:"id":"?|\/id)(\d{6,12})/g;

  const idMarks: { at: number; id: string }[] = [];
  for (const m of text.matchAll(idPattern)) idMarks.push({ at: m.index!, id: m[1] });

  const ownerOf = (at: number): string | null => {
    let owner: string | null = null;
    for (const mark of idMarks) {
      if (mark.at > at) break;
      owner = mark.id;
    }
    return owner;
  };

  for (const block of text.matchAll(/versionHistory/g)) {
    if (ownerOf(block.index!) !== iosId) continue;

    const nextBlock = text.indexOf("versionHistory", block.index! + 1);
    const region = text.slice(block.index!, nextBlock === -1 ? block.index! + 120_000 : nextBlock);

    // One entry at a time: find each version, then read only its own window. A single sweeping
    // pattern lets one entry's fields be matched against the next entry's.
    for (const m of region.matchAll(/"versionDisplay":"([^"]{1,24})"/g)) {
      const version = m[1];
      const window = region.slice(m.index!, m.index! + 1_400);
      const date = /"releaseDate":"(\d{4}-\d{2}-\d{2})"/.exec(window)?.[1];
      if (!date) continue;
      const notes = summarizeNotes(/"releaseNotes":"((?:[^"\\]|\\.)*)"/.exec(window)?.[1]);

      const prior = found.get(version);
      // Later captures repeat the same history; the earliest date seen wins.
      if (!prior || date < prior.date) found.set(version, { date, notes: notes ?? prior?.notes });
      else if (!prior.notes && notes) prior.notes = notes;
    }
  }

  return [...found]
    // Omit `notes` entirely when there are none, rather than carrying an undefined key around.
    .map(([version, v]) => (v.notes ? { version, date: v.date, notes: v.notes } : { version, date: v.date }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function sampleEvenly<T>(rows: T[], max = MAX_CAPTURES): T[] {
  if (rows.length <= max) return rows;
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => rows[Math.round(i * step)]);
}

/** `1.10.0` → true, `1.10.3` → false. Patch releases are noise on a multi-year timeline. */
const isFeatureRelease = (v: string) => /^\d+\.\d+(\.0)?$/.test(v.trim());

/** Derive events by comparing consecutive snapshots, plus the union of all version histories. */
export function deriveEvents(snaps: StoreSnapshot[], developer: string | null): {
  events: Event[];
  totalVersions: number;
} {
  const events: Event[] = [];
  const base = (s: StoreSnapshot) => ({
    source: "appstore" as const,
    by: developer,
    by_founder: true,
    number: null,
    url: storeViewUrl(s.ts, s.original),
  });

  const priceLabel = (o: Offer) =>
    `${o.formatted}${o.period && o.period !== "lifetime" ? `/${o.period}` : o.period === "lifetime" ? " lifetime" : ""}`;

  // A capture whose embedded blob is missing yields no offers — Apple's newer page structure drops
  // it. That is unparseable, NOT "they removed every plan", and comparing against it would emit a
  // fake teardown-and-relaunch of the entire pricing model.
  const withOffers = snaps.filter((s) => s.offers.length > 0);

  let prevOffers: StoreSnapshot | null = null;
  for (const s of withOffers) {
    if (prevOffers) {
      const before = new Map(prevOffers.offers.map((o) => [o.id, o]));
      const after = new Map(s.offers.map((o) => [o.id, o]));

      // Detection runs per SKU — a new SKU family at an existing price is a real move — but the
      // *titles* are deduplicated, because an app carrying a legacy and a replacement SKU at the
      // same price would otherwise report "Added plan: Pro $1.99/month" twice on the same day.
      const say = (title: string) => {
        if (!events.some((e) => e.date === s.date && e.title === title)) {
          events.push({ ...base(s), date: s.date, kind: "product_change", date_exact: false, title });
        }
      };

      for (const [id, o] of after) {
        const was = before.get(id);
        if (!was) say(`Added plan: ${o.label ? `${o.label} ` : ""}${priceLabel(o)}`);
        else if (was.price !== o.price) {
          say(`Price changed: ${o.label ?? "plan"} ${was.formatted} → ${priceLabel(o)}`);
        }
      }
      for (const [id, o] of before) {
        if (!after.has(id)) say(`Retired plan: ${o.label ? `${o.label} ` : ""}${priceLabel(o)}`);
      }
      if (prevOffers.model !== s.model) {
        events.push({
          ...base(s), date: s.date, kind: "product_change", date_exact: false,
          title: `Monetization changed: ${prevOffers.model} → ${s.model}`,
        });
      }
    } else {
      // The first capture where the catalogue is legible: state the model rather than implying it.
      const plans = summarizeOffers(s.offers);
      events.push({
        ...base(s), date: s.date, kind: "product_change", date_exact: false,
        title: `${s.model === "freemium" ? "Freemium" : s.model} — ${plans.length} plan${plans.length === 1 ? "" : "s"}: ${plans.map(priceLabel).join(", ")}`,
      });
    }
    prevOffers = s;
  }

  let prev: StoreSnapshot | null = null;
  for (const s of snaps) {
    if (prev) {
      if (s.name && prev.name && s.name !== prev.name) {
        // The App Store title is a ranking input, so changing it is deliberate ASO work.
        events.push({
          ...base(s), date: s.date, kind: "aso", date_exact: false,
          title: `App Store title changed to “${s.name}”`,
        });
      }
      if (s.description && prev.description && s.description !== prev.description) {
        events.push({
          ...base(s), date: s.date, kind: "aso", date_exact: false,
          title: "App Store description rewritten",
        });
      }
      if (s.price !== undefined && prev.price !== undefined && s.price !== prev.price) {
        events.push({
          ...base(s), date: s.date, kind: "product_change", date_exact: false,
          title: `Price changed from ${prev.price} to ${s.price}${s.currency ? ` ${s.currency}` : ""}`,
        });
      }
    }
    prev = s;
  }

  // Version history is absolute, not a diff: each capture carries the full list, so the union across
  // captures reconstructs the release timeline with Apple's own exact dates.
  const versions = new Map<string, { date: string; notes?: string; snap: StoreSnapshot }>();
  for (const s of snaps) {
    for (const v of s.versions) {
      const seen = versions.get(v.version);
      if (!seen || v.date < seen.date) {
        versions.set(v.version, { date: v.date, notes: v.notes ?? seen?.notes, snap: s });
      } else if (!seen.notes && v.notes) {
        seen.notes = v.notes;
      }
    }
  }

  for (const [version, { date, notes, snap }] of versions) {
    if (!isFeatureRelease(version)) continue;
    events.push({
      ...base(snap), date, kind: "product_change",
      // Apple's own release date, not a capture date — this one is exact.
      date_exact: true,
      // What shipped, where Apple's notes say something beyond "bug fixes".
      title: notes ? `Version ${version}: ${notes}` : `Version ${version} released`,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return { events, totalVersions: versions.size };
}

export const appstore: Source = {
  id: "appstore",
  tier: 0,
  hosts: ["web.archive.org"],
  needs: ["store_url"],

  async collect(app, ctx: Ctx): Promise<SourceResult> {
    const storeUrl = app.store_url!;
    try {
      const rows = JSON.parse(await ctx.fetchText(storeCdxUrl(storeUrl))) as string[][];
      if (rows.length <= 1) {
        return {
          events: [], metrics: [],
          coverage: { status: "empty", note: "no archived App Store captures" },
        };
      }

      const all = rows.slice(1);
      const picked = sampleEvenly(all);

      const snaps: StoreSnapshot[] = [];
      const metrics: Metric[] = [];
      let failed = 0;
      let noData = 0;
      let done = 0;

      for (const [ts, original] of picked) {
        ctx.progress?.(`reading capture ${++done}/${picked.length}`);
        const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
        try {
          const snap = { date, ts, original, ...extractSnapshot(await ctx.fetchText(storeCaptureUrl(ts, original)), app.ios_id) };
          if (snap.ratingCount === undefined && !snap.name && !snap.versions.length) {
            noData++;
            continue;
          }
          snaps.push(snap);

          const url = storeViewUrl(ts, original);
          if (snap.ratingCount !== undefined) {
            metrics.push({ date, metric: "ios_rating_count", value: snap.ratingCount, url });
          }
          if (snap.ratingValue !== undefined) {
            metrics.push({ date, metric: "ios_rating_avg", value: snap.ratingValue, url });
          }
          // Cheapest plan per billing period, so pricing can be charted alongside growth.
          for (const period of ["month", "year", "lifetime"] as const) {
            const cheapest = snap.offers
              .filter((o) => o.period === period)
              .sort((a, b) => a.price - b.price)[0];
            if (cheapest) {
              metrics.push({ date, metric: `ios_price_${period}`, value: cheapest.price, url });
            }
          }
        } catch {
          failed++;
        }
      }

      metrics.sort((a, b) => a.date.localeCompare(b.date));
      const { events, totalVersions } = deriveEvents(snaps, app.founder);

      const shipped = events.filter((e) => e.title.startsWith("Version")).length;
      const note =
        `${all.length} captures, sampled ${picked.length}, ` +
        `${metrics.filter((m) => m.metric === "ios_rating_count").length} rating points, ` +
        `${totalVersions} releases seen (${shipped} feature releases shown), ` +
        `${snaps.filter((s) => s.offers.length).length} captures with a legible price catalogue` +
        (failed ? `, ${failed} unreachable` : "") +
        (noData ? `, ${noData} unparseable` : "");

      return {
        events,
        metrics,
        coverage: {
          status: failed || noData ? "partial" : metrics.length || events.length ? "ok" : "empty",
          note,
        },
      };
    } catch (err) {
      return {
        events: [], metrics: [],
        coverage: { status: "failed", note: err instanceof Error ? err.message : String(err) },
      };
    }
  },
};
