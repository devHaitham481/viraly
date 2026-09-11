/**
 * The product's own writing — the SEO and content play.
 *
 * Sitemap → post URLs → each post's `datePublished`. These are `own_content` events: deliberate,
 * dated, founder-side marketing moves, and for many indie apps the largest single acquisition
 * channel. Free, no key, and the sitemap is a single request.
 */

import type { Event } from "../schema.ts";
import type { Ctx } from "../fetcher.ts";
import type { Source, SourceResult } from "./registry.ts";

/** Apex first: `www.` often 301s, and a redirect that is not followed silently yields nothing. */
export const sitemapUrls = (domain: string) => [
  `https://${domain}/sitemap.xml`,
  `https://${domain}/sitemap_index.xml`,
];

/** Path segments that mark a post rather than a policy or marketing page. */
const POST_PATH = /\/(blog|posts?|news|articles?|changelog|journal)\//i;

/** Bound the work: a content-heavy site can list hundreds of posts. */
const MAX_POSTS = 30;

export function postUrlsFromSitemap(xml: string, domain: string): string[] {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  // Match the hostname, not a substring: `https://cdn.example.com/blog/habitkit.app/x` contains the
  // domain but is not the product's own post.
  return locs
    .filter((u) => {
      try {
        const h = new URL(u).hostname.replace(/^www\./, "");
        return (h === domain || h.endsWith(`.${domain}`)) && POST_PATH.test(u);
      } catch {
        return false;
      }
    })
    .slice(0, MAX_POSTS);
}

/**
 * Find a publication date.
 *
 * JSON-LD `datePublished` first (most reliable), then the OpenGraph meta tag, then a date in the URL
 * slug. No date means the post is skipped — a post placed at the wrong point on a timeline is worse
 * than one that is absent, and `coverage` records how many were dropped.
 */
export function publishedDate(html: string, url: string): string | null {
  const ld = /"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1];
  if (ld) return ld;

  const meta =
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|date)["'][^>]+content=["'](\d{4}-\d{2}-\d{2})/i.exec(html)?.[1];
  if (meta) return meta;

  const slug = /\/(\d{4})[/-](\d{2})[/-](\d{2})\//.exec(url);
  return slug ? `${slug[1]}-${slug[2]}-${slug[3]}` : null;
}

/** Turn a slug into something readable when the page gives us no title. */
function titleOf(html: string, url: string): string {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  if (t && t.length > 3) return t.replace(/\s+/g, " ").slice(0, 90);
  const slug = url.replace(/\/+$/, "").split("/").pop() ?? url;
  return slug.replace(/[-_]/g, " ").slice(0, 90);
}

export const blog: Source = {
  id: "blog",
  tier: 0,
  hosts: [],
  needs: ["domain"],

  async collect(app, ctx: Ctx): Promise<SourceResult> {
    const domain = app.domain!;

    let xml: string | null = null;
    for (const url of sitemapUrls(domain)) {
      try {
        xml = await ctx.fetchText(url);
        break;
      } catch {
        // Try the next conventional location.
      }
    }
    if (!xml) {
      return { events: [], metrics: [], coverage: { status: "empty", note: "no sitemap found" } };
    }

    const urls = postUrlsFromSitemap(xml, domain);
    if (!urls.length) {
      return {
        events: [], metrics: [],
        coverage: { status: "empty", note: "sitemap has no blog or changelog posts" },
      };
    }

    const events: Event[] = [];
    let undated = 0;
    let failed = 0;
    let done = 0;

    for (const url of urls) {
      ctx.progress?.(`reading post ${++done}/${urls.length}`);
      try {
        const html = await ctx.fetchText(url);
        const date = publishedDate(html, url);
        if (!date) {
          undated++;
          continue;
        }
        events.push({
          date,
          kind: "own_content",
          title: titleOf(html, url),
          source: "blog",
          by: app.name,
          by_founder: true,
          url,
          number: null,
          date_exact: true,
        });
      } catch {
        failed++;
      }
    }

    events.sort((a, b) => a.date.localeCompare(b.date));
    const note =
      `${urls.length} posts in sitemap, ${events.length} dated` +
      (undated ? `, ${undated} undated (skipped)` : "") +
      (failed ? `, ${failed} unreachable` : "");

    return {
      events, metrics: [],
      coverage: { status: undated || failed ? "partial" : events.length ? "ok" : "empty", note },
    };
  },
};
