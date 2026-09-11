/**
 * Site structure over time — the SEO and marketing-infrastructure record.
 *
 * One CDX query returns every URL the archive has ever seen under a domain, with dates. The first
 * appearance of a path is the closest public evidence of when a team built something: the month a
 * blog started, the day a press kit went up, whether an affiliate programme ever existed.
 *
 * For HabitKit this shows the content play was a single burst in mid-2024 that then stopped — six
 * content pages in 2024, one since. That is a strategic fact a founder weighing "should I invest in
 * content" actually wants, and no other source here carries it.
 *
 * It is also the honest slice of the influencer question. Whether a team *paid* creators is not
 * publicly determinable — sponsorship disclosure is inconsistent and most platforms are login-walled
 * — but an `/affiliates` or `/creators` page is direct, dated evidence that a programme existed.
 */

import type { Event, Metric } from "../schema.ts";
import type { Ctx } from "../fetcher.ts";
import type { Source, SourceResult } from "./registry.ts";

const CDX = "http://web.archive.org/cdx/search/cdx";

export const structureCdxUrl = (domain: string) =>
  `${CDX}?url=${encodeURIComponent(domain)}*&output=json&filter=statuscode:200` +
  `&collapse=urlkey&fl=timestamp,original&limit=2000`;

/** Files that are not pages. Counting them would make an icon refresh look like a content push. */
const ASSET = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?|ttf|eot|map|xml|txt|json|zip|pdf|mp4|webm)$/i;

/**
 * Sections whose first appearance is a marketing decision worth dating.
 *
 * Matched on a path segment, not a substring: "kit" matches `habitkit_icon.png` and would report an
 * icon as a press kit.
 */
const LANDMARKS: { pattern: RegExp; title: string; kind: Event["kind"] }[] = [
  { pattern: /^\/(press|presskit|press-kit|media-?kit)(\b|\.)/i, title: "Published a press kit", kind: "own_content" },
  { pattern: /^\/(affiliates?|partners?|creators?|referrals?|ambassadors?)\b/i, title: "Launched an affiliate or creator programme", kind: "own_content" },
  { pattern: /^\/(pricing|plans)\b/i, title: "Published a pricing page", kind: "product_change" },
  { pattern: /^\/(changelog|releases|whats-new)\b/i, title: "Published a public changelog", kind: "own_content" },
  { pattern: /^\/(docs?|help|support|faq)\b/i, title: "Published documentation or help", kind: "own_content" },
  { pattern: /^\/(careers?|jobs)\b/i, title: "Started hiring publicly", kind: "own_content" },
];

/** Paths that hold written content — the SEO surface. */
const CONTENT = /^\/(blog|articles?|guides?|posts?|resources|learn)\//i;

/** A section gaining this many pages inside `PSEO_WINDOW_DAYS` looks generated, not written. */
const PSEO_PAGES = 12;
const PSEO_WINDOW_DAYS = 45;

export interface PathFirstSeen {
  path: string;
  date: string;
}

/**
 * Earliest archived date per distinct path.
 *
 * Assets are kept here and filtered where *pages* are counted. The two purposes differ: an icon
 * refresh is not a content push, but `/presskit.zip` is a marketing artifact with a date on it — and
 * excluding it by extension silently deleted the clearest press-effort signal on the site.
 */
export function firstSeenPaths(rows: string[][]): PathFirstSeen[] {
  const first = new Map<string, string>();

  for (const [ts, original] of rows) {
    if (!ts || !original) continue;
    let path: string;
    try {
      path = new URL(original.startsWith("http") ? original : `https://${original}`).pathname;
    } catch {
      continue;
    }

    const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    const seen = first.get(path);
    if (!seen || date < seen) first.set(path, date);
  }

  return [...first]
    .map(([path, date]) => ({ path, date }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const daysBetween = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

export const structure: Source = {
  id: "structure",
  tier: 0,
  hosts: ["web.archive.org"],
  needs: ["domain"],

  async collect(app, ctx: Ctx): Promise<SourceResult> {
    const domain = app.domain!;
    try {
      const rows = JSON.parse(await ctx.fetchText(structureCdxUrl(domain))) as string[][];
      if (rows.length <= 1) {
        return {
          events: [], metrics: [],
          coverage: { status: "empty", note: `no archived URLs under ${domain}` },
        };
      }

      const paths = firstSeenPaths(rows.slice(1));
      const events: Event[] = [];
      const evidence = `https://web.archive.org/web/*/${domain}*`;

      const make = (date: string, title: string, kind: Event["kind"]): Event => ({
        date, kind, title,
        source: "structure",
        by: null,
        by_founder: true,
        url: evidence,
        number: null,
        // A first capture bounds when a page appeared; it does not date its publication.
        date_exact: false,
      });

      for (const { pattern, title, kind } of LANDMARKS) {
        const hit = paths.find((p) => pattern.test(p.path));
        if (hit) events.push(make(hit.date, title, kind));
      }

      const content = paths.filter((p) => CONTENT.test(p.path) && !ASSET.test(p.path));
      if (content.length) {
        events.push(
          make(content[0].date, `Started publishing content (${content.length} pages archived)`, "own_content"),
        );

        // A burst of pages under one section in a short window is generated, not written.
        const bySection = new Map<string, PathFirstSeen[]>();
        for (const c of content) {
          const section = c.path.split("/")[1]?.toLowerCase() ?? "";
          bySection.set(section, [...(bySection.get(section) ?? []), c]);
        }
        for (const [section, pages] of bySection) {
          if (pages.length < PSEO_PAGES) continue;
          for (let i = 0; i + PSEO_PAGES - 1 < pages.length; i++) {
            const window = pages[i + PSEO_PAGES - 1];
            if (daysBetween(pages[i].date, window.date) <= PSEO_WINDOW_DAYS) {
              events.push(
                make(pages[i].date, `Programmatic SEO: ${pages.length} pages under /${section}`, "own_content"),
              );
              break;
            }
          }
        }
      }

      // Cumulative page count — how the site's surface area grew.
      const metrics: Metric[] = [];
      const pages = paths.filter((p) => !ASSET.test(p.path));
      let running = 0;
      let lastMonth = "";
      for (const p of pages) {
        running++;
        const month = p.date.slice(0, 7);
        if (month !== lastMonth) {
          metrics.push({ date: p.date, metric: "site_pages", value: running, url: evidence });
          lastMonth = month;
        }
      }

      events.sort((a, b) => a.date.localeCompare(b.date));

      return {
        events, metrics,
        coverage: {
          status: events.length ? "ok" : "empty",
          note: `${rows.length - 1} archived URLs, ${pages.length} pages, ${events.length} structural events`,
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
