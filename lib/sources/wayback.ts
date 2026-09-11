/**
 * The Wayback Machine — the spine of the product.
 *
 * Turns a static landing page into a time series. Sampling archived captures and diffing the
 * headline recovers the positioning history, which no other source has: during research this found
 * that HabitKit was a *social* habit-sharing web app in Aug 2021, fifteen months before the iOS
 * release, and was relaunched as a private tile-grid "Consistency Tracker" with the social framing
 * dropped. No manual pass had that (PRD §6.2).
 *
 * **No LLM here, deliberately.** A positioning change *is* a headline change, and extracting one is
 * deterministic — which keeps the output golden-testable and the cost at zero. A model that
 * summarises *what* changed is polish, and can be layered on later without touching this.
 *
 * archive.org throttles by IP and has already cut us off once (PRD §9.9), so this source is the main
 * reason the global limiter exists. It draws a token per capture at 0.5/sec.
 */

import type { Event } from "../schema.ts";
import type { Ctx } from "../fetcher.ts";
import type { Source, SourceResult } from "./registry.ts";

const CDX = "http://web.archive.org/cdx/search/cdx";

/**
 * Monthly captures. `collapse=timestamp:6` keeps one row per month, which bounds the list without
 * needing to know how heavily a site was crawled.
 */
export const cdxUrl = (domain: string) =>
  `${CDX}?url=${encodeURIComponent(domain)}&output=json&filter=statuscode:200` +
  `&collapse=timestamp:6&fl=timestamp,original&limit=200`;

/**
 * Two URLs per capture, for two different jobs.
 *
 * `id_` returns the original bytes — right for parsing, wrong for a human: nothing rewrites the
 * asset paths, so the page renders unstyled and broken. The plain replay URL is what a link should
 * point at.
 */
export const captureUrl = (ts: string, url: string) =>
  `http://web.archive.org/web/${ts}id_/${url}`;

export const captureViewUrl = (ts: string, url: string) =>
  `https://web.archive.org/web/${ts}/${url}`;

/** Worst-case fetches per crawl. At 0.5/sec that is ~48s — fine for a queued job, bounded for cost. */
const MAX_CAPTURES = 24;

export interface Positioning {
  date: string;
  /** Raw CDX timestamp and URL, kept so the human-facing link can be built correctly. */
  ts: string;
  original: string;
  title: string;
  hero: string;
}

/**
 * Pull the headline out of an archived page.
 *
 * Deliberately crude: strip scripts and tags, take the title and the opening copy. CSS selectors
 * cannot do this job — no selector survives five years and three site rewrites (HabitKit moved to
 * Tailwind+Alpine partway through), whereas "the first text on the page" does (PRD §13.2).
 */
/**
 * Text that means "this is archive.org, not the site".
 *
 * The Wayback Machine serves interstitials — a redirect notice, an unavailable page — with HTTP 200.
 * Treated as content, one of those in the middle of a sample produces a positioning change *to* the
 * interstitial and another change back, inventing two `product_change` events with real, checkable
 * URLs and inflating the repositioning count by two.
 */
const INTERSTITIAL = [
  "wayback machine",
  "internet archive",
  "got an http",
  "this page is not available",
  "the wayback machine has not archived",
  "redirecting to",
];

export function looksLikeInterstitial(title: string, hero: string): boolean {
  const text = `${title} ${hero}`.toLowerCase();
  // Short pages are the tell: a real landing page carries far more copy than a notice.
  return INTERSTITIAL.some((s) => text.includes(s)) && hero.length < 400;
}

export function extractPositioning(html: string): { title: string; hero: string } {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const text = decodeEntities(stripTags(body)).replace(/\s+/g, " ").trim();
  return { title: decodeEntities(title).replace(/\s+/g, " "), hero: text.slice(0, 300) };
}

/**
 * Remove tags, respecting quoted attribute values.
 *
 * A naive `/<[^>]+>/` is wrong on real pages: Alpine and htmx attributes contain `>` inside quotes
 * (`@scroll.window="scrolled = window.scrollY > 24"`), so the regex closes the tag early and spills
 * markup into the extracted copy. That corrupted the most recent HabitKit capture.
 */
export function stripTags(html: string): string {
  let out = "";
  let inTag = false;
  let quote: string | null = null;

  for (const ch of html) {
    if (inTag) {
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        inTag = false;
        out += " ";
      }
    } else if (ch === "<") {
      inTag = true;
    } else {
      out += ch;
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/** Pick up to `max` captures, evenly spread, always keeping the first and last. */
export function sampleCaptures<T>(rows: T[], max = MAX_CAPTURES): T[] {
  if (rows.length <= max) return rows;
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => rows[Math.round(i * step)]);
}

/**
 * Compare consecutive snapshots and emit an event wherever the positioning actually changed.
 *
 * Diffs the extracted *tagline*, not the raw page. Body copy, build hashes and analytics snippets
 * churn constantly — 48 distinct content digests across 60 captures of habitkit.app — while the
 * message stays put, so anything coarser reports changes that did not happen.
 */
export function diffPositioning(snaps: Positioning[], domain: string): Event[] {
  const events: Event[] = [];
  let previous: string | null = null;

  for (const s of snaps) {
    const line = headline(s, domain);
    const key = normalise(line);
    if (!key) continue;

    if (previous === null) {
      events.push(makeEvent(s, domain, `First archived: \u201C${line}\u201D`));
    } else if (key !== previous) {
      events.push(makeEvent(s, domain, `Positioning changed to: \u201C${line}\u201D`));
    }
    previous = key;
  }
  return events;
}

const normalise = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Chrome that sits above the tagline on almost every landing page. */
const NAV_WORDS = new Set([
  "sign", "in", "up", "log", "login", "logout", "menu", "skip", "to", "content",
  "home", "blog", "pricing", "docs", "download", "get", "started", "toggle", "navigation",
  "features", "reviews", "faq", "app",
]);

/** Brand tokens come from the domain, not the title — the domain is short and stable. */
const brandOf = (domain: string) => domain.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");

const isBrandish = (word: string, brand: string) => {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !w || NAV_WORDS.has(w) || (w.length > 1 && brand.includes(w));
};

/**
 * The tagline for a capture.
 *
 * Two shapes occur and they need opposite handling. Sometimes the `<title>` *is* the positioning
 * ("HabitKit \u00B7 The Habit Tracker You Can Actually See") and should be used as-is; sometimes it is
 * only the brand ("HabitKit", "Habit Tracker - HabitKit") and the real message is in the page copy
 * behind a banner of nav links. Which one applies is decided by whether the title still says
 * anything once brand and nav words are removed.
 */
export function headline(s: Positioning, domain: string): string {
  const brand = brandOf(domain);

  const titleRest = s.title.split(/[\s\u00B7|\u2013\u2014-]+/).filter((w) => !isBrandish(w, brand));
  if (titleRest.length >= 3) return s.title.slice(0, 80).trim();

  // Otherwise the title is just branding. Drop it from the front of the copy if it is repeated
  // there, then peel off any remaining brand and nav words.
  let hero = s.hero;
  if (s.title.length > 3 && hero.toLowerCase().startsWith(s.title.toLowerCase())) {
    hero = hero.slice(s.title.length).trim();
  }

  const words = hero.split(" ");
  let i = 0;
  // Capped, so a tagline that legitimately contains the product name is never eaten whole.
  while (i < words.length && i < 6 && isBrandish(words[i], brand)) i++;

  const rest = words.slice(i).join(" ").trim();
  return (rest.length > 8 ? rest : hero).slice(0, 80).trim();
}

function makeEvent(s: Positioning, domain: string, title: string): Event {
  return {
    date: s.date,
    kind: "product_change",
    title,
    source: "wayback",
    by: null,
    by_founder: true,
    url: captureViewUrl(s.ts, s.original),
    number: null,
    // A capture dates when we *saw* the change, not when it shipped: the real change happened
    // somewhere between this capture and the previous one.
    date_exact: false,
  };
}

export const wayback: Source = {
  id: "wayback",
  tier: 0,
  hosts: ["web.archive.org"],
  needs: ["domain"],

  async collect(app, ctx: Ctx): Promise<SourceResult> {
    const domain = app.domain!;
    try {
      const rows = JSON.parse(await ctx.fetchText(cdxUrl(domain))) as string[][];
      if (rows.length <= 1) {
        return {
          events: [],
          metrics: [],
          coverage: { status: "empty", note: `no archived captures of ${domain}` },
        };
      }

      const all = rows.slice(1); // drop the header row
      const picked = sampleCaptures(all);

      const snaps: Positioning[] = [];
      let failed = 0;
      let unusable = 0;
      let done = 0;
      for (const [ts, original] of picked) {
        ctx.progress?.(`reading capture ${++done}/${picked.length}`);
        try {
          const html = await ctx.fetchText(captureUrl(ts, original));
          const { title, hero } = extractPositioning(html);
          if (looksLikeInterstitial(title, hero) || hero.length < 40) {
            unusable++;
            continue;
          }
          snaps.push({
            date: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`,
            ts, original, title, hero,
          });
        } catch {
          // One unreachable capture is normal; the run is still useful. Counted, not fatal.
          failed++;
        }
      }

      const events = diffPositioning(snaps, domain);
      const note =
        `${all.length} captures, sampled ${picked.length}, ` +
        `${events.length} positioning changes` +
        (failed ? `, ${failed} captures unreachable` : "") +
        (unusable ? `, ${unusable} archive notices skipped` : "");

      return {
        events,
        metrics: [],
        // `partial` is the honest status when some captures could not be read — the timeline may be
        // missing a change we simply never saw.
        coverage: { status: failed ? "partial" : events.length ? "ok" : "empty", note },
      };
    } catch (err) {
      return {
        events: [],
        metrics: [],
        coverage: { status: "failed", note: err instanceof Error ? err.message : String(err) },
      };
    }
  },
};
