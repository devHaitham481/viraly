/**
 * Hacker News, via the Algolia search API. Free, no auth, complete history.
 *
 * Searches the **domain**, never the product name. Measured during research: `habitkit` returns
 * 12,135 hits (habitat, habitition, a user called `habitit`); `habitkit.app` returns 1, and it is
 * the right one. Four orders of magnitude of noise, removed by not searching the name (PRD §6.3).
 */

import type { Event } from "../schema.ts";
import type { Ctx } from "../fetcher.ts";
import type { Source, SourceResult } from "./registry.ts";

const BASE = "https://hn.algolia.com/api/v1";

export const hnSearchUrl = (domain: string) =>
  `${BASE}/search?query=${encodeURIComponent(domain)}&restrictSearchableAttributes=url,title&hitsPerPage=50`;

interface Hit {
  objectID: string;
  created_at?: string;
  title?: string;
  story_title?: string;
  author?: string;
  points?: number;
  url?: string;
}

export const hackernews: Source = {
  id: "hackernews",
  tier: 0,
  hosts: ["hn.algolia.com"],
  needs: ["domain"],

  async collect(app, ctx: Ctx): Promise<SourceResult> {
    const domain = app.domain!;
    try {
      const { hits } = JSON.parse(await ctx.fetchText(hnSearchUrl(domain))) as { hits: Hit[] };

      const events: Event[] = hits
        .filter((h) => h.created_at && (h.title || h.story_title))
        .map((h) => ({
          date: h.created_at!.slice(0, 10),
          // Whether the founder posted it is unknowable from HN alone — resolved at E5 once the
          // founder's handles are known. Until then it is a mention, which is the safe default.
          kind: "mention" as const,
          title: h.title ?? h.story_title!,
          source: "hackernews" as const,
          by: h.author ?? null,
          by_founder: false,
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          number: typeof h.points === "number" ? h.points : null,
          date_exact: true,
        }));

      return {
        events,
        metrics: [],
        coverage: events.length
          ? { status: "ok", note: `${events.length} hits for ${domain}` }
          : { status: "empty", note: `no HN submissions mention ${domain}` },
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
