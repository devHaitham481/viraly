/**
 * Apple's iTunes Search API — the resolver, and the first source.
 *
 * Free, no auth, no key. One call returns 44 fields including the developer's name, the product's
 * domain (`sellerUrl`), the exact release date and the live rating count. It is the highest-value
 * endpoint in the whole catalogue (PRD §6.1) and the reason v1 is apps-only (DECISIONS.md D1).
 *
 * This module is the *shape* every later source copies: fetch → map to Event[]/Metric[] → return a
 * coverage row whether it worked or not. It is the one exception to the
 * `(app: AppIdentity) => ...` signature in PRD §12.2, because it runs *before* an identity exists —
 * it is what produces one.
 */

import type {
  AppIdentity,
  Candidate,
  Coverage,
  Event,
  Metric,
} from "../schema.ts";
import type { Ctx } from "../fetcher.ts";

const BASE = "https://itunes.apple.com";

export const searchUrl = (q: string) =>
  `${BASE}/search?term=${encodeURIComponent(q)}&entity=software&country=us&limit=12`;
export const lookupUrl = (id: string) =>
  `${BASE}/lookup?id=${encodeURIComponent(id)}&country=us`;

/** The subset of the 44 fields we actually read. Everything optional — Apple omits fields freely. */
interface ItunesResult {
  trackId?: number;
  trackName?: string;
  sellerName?: string;
  artistName?: string;
  sellerUrl?: string;
  trackViewUrl?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  currentVersionReleaseDate?: string;
  version?: string;
  userRatingCount?: number;
  averageUserRating?: number;
  bundleId?: string;
}

// Apple serves these endpoints as text/javascript, so parsing the body text is deliberate.
async function getJson(url: string, ctx: Ctx): Promise<{ results: ItunesResult[] }> {
  return JSON.parse(await ctx.fetchText(url));
}

/** `2022-11-26T08:00:00Z` → `2022-11-26`. Returns null rather than inventing a date. */
function isoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function hostOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Step 1 of resolution: a name query → candidates for the user to choose between.
 *
 * Deliberately does NOT auto-pick, even for a single result (DECISIONS.md D3). The App Store
 * currently holds two unrelated apps called "HabitKit"; picking the wrong one yields a complete,
 * confident, entirely wrong timeline.
 */
export async function searchApps(query: string, ctx: Ctx): Promise<Candidate[]> {
  const q = query.trim();
  if (!q) return [];

  const { results } = await getJson(searchUrl(q), ctx);

  return results
    .filter((r): r is ItunesResult & { trackId: number } => typeof r.trackId === "number")
    .map((r) => ({
      ios_id: String(r.trackId),
      name: r.trackName ?? "(untitled)",
      developer: r.sellerName ?? r.artistName ?? "(unknown developer)",
      domain: hostOf(r.sellerUrl),
      released: isoDate(r.releaseDate) ?? "",
      rating_count: r.userRatingCount ?? 0,
      rating_avg: typeof r.averageUserRating === "number" ? r.averageUserRating : null,
      artwork: r.artworkUrl100 ?? null,
      store_url: r.trackViewUrl ?? `https://apps.apple.com/app/id${r.trackId}`,
    }));
}

export interface ItunesCrawl {
  app: AppIdentity;
  events: Event[];
  metrics: Metric[];
  coverage: Coverage;
}

/**
 * Step 2: a chosen App Store id → identity, events and metrics.
 *
 * Never throws. A failure becomes `coverage.status = "failed"` with the reason, because a source
 * that can fail silently is the characteristic break of this system (PRD §9.9, EPICS Stage 6).
 */
export async function lookupApp(iosId: string, ctx: Ctx): Promise<ItunesCrawl> {
  const empty: AppIdentity = {
    name: "",
    domain: null,
    ios_id: iosId,
    play_id: null,
    founder: null,
    founder_source: null,
    artwork: null,
  };

  let r: ItunesResult;
  try {
    const { results } = await getJson(lookupUrl(iosId), ctx);
    if (!results?.length) {
      return {
        app: empty,
        events: [],
        metrics: [],
        coverage: { source: "itunes", status: "empty", note: `no app with id ${iosId}` },
      };
    }
    r = results[0];
  } catch (err) {
    return {
      app: empty,
      events: [],
      metrics: [],
      coverage: {
        source: "itunes",
        status: "failed",
        note: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const storeUrl = r.trackViewUrl ?? `https://apps.apple.com/app/id${iosId}`;
  const developer = r.sellerName ?? r.artistName ?? null;

  const app: AppIdentity = {
    name: r.trackName ?? "",
    domain: hostOf(r.sellerUrl),
    ios_id: iosId,
    // The iOS bundle id is usually the Play package id too. Unverified until E5 actually checks
    // the Play listing, so it is recorded as a lead, not a fact.
    play_id: r.bundleId ?? null,
    founder: developer,
    founder_source: developer ? "itunes lookup sellerName" : null,
    artwork: r.artworkUrl100 ?? null,
  };

  const events: Event[] = [];

  const released = isoDate(r.releaseDate);
  if (released) {
    events.push({
      date: released,
      kind: "launch",
      title: "iOS app released on the App Store",
      source: "itunes",
      by: developer,
      by_founder: true,
      url: storeUrl,
      number: null,
      date_exact: true,
    });
  }

  const versionDate = isoDate(r.currentVersionReleaseDate);
  if (versionDate && r.version) {
    events.push({
      date: versionDate,
      kind: "product_change",
      title: `Version ${r.version} released`,
      source: "itunes",
      by: developer,
      by_founder: true,
      url: storeUrl,
      number: null,
      date_exact: true,
    });
  }

  const metrics: Metric[] = [];
  if (typeof r.userRatingCount === "number") {
    metrics.push({
      // A live counter read today — not a historical point. The dated series comes from archived
      // store pages at E4.
      date: ctx.now().toISOString().slice(0, 10),
      metric: "ios_rating_count",
      value: r.userRatingCount,
      url: lookupUrl(iosId),
    });
  }

  return {
    app,
    events,
    metrics,
    coverage: {
      source: "itunes",
      status: "ok",
      note: `${events.length} events, ${metrics.length} metrics`,
    },
  };
}
