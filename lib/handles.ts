/**
 * Finding the founder's accounts.
 *
 * This is Axis B's bottleneck. One resolved handle unlocks an entire posting history in a call or
 * two — everything a founder did in public, dated and in order — and until it is resolved, every
 * founder-side source is blocked (PRD §7).
 *
 * It runs during identity resolution rather than as a queued source, because the sources that need
 * handles would otherwise have to wait for one that discovers them, and the worker deliberately has
 * no dependency ordering. One extra fetch at resolve time buys that simplicity.
 */

import type { Ctx } from "./fetcher.ts";
import type { Handles } from "./schema.ts";

/** Pages that carry a footer or a bio. Tried in order; the first two usually suffice. */
const CANDIDATE_PATHS = ["/", "/about", "/contact"];

interface Rule {
  key: keyof Handles;
  host: RegExp;
  /** Path segments that are never a username. */
  reject?: RegExp;
}

const RULES: Rule[] = [
  { key: "x", host: /^(?:www\.)?(?:twitter|x)\.com$/i, reject: /^(?:share|intent|home|i|hashtag|search)$/i },
  { key: "github", host: /^(?:www\.)?github\.com$/i, reject: /^(?:features|pricing|about|topics|sponsors)$/i },
  { key: "reddit", host: /^(?:www\.|old\.)?reddit\.com$/i },
  { key: "youtube", host: /^(?:www\.)?youtube\.com$/i, reject: /^(?:watch|embed|results|feed)$/i },
  { key: "linkedin", host: /^(?:www\.)?linkedin\.com$/i, reject: /^(?:feed|shareArticle|sharing)$/i },
  { key: "instagram", host: /^(?:www\.)?instagram\.com$/i, reject: /^(?:p|reel|explore)$/i },
];

/**
 * Pull a username out of a social URL.
 *
 * Reddit and YouTube nest theirs (`/user/x`, `/@x`, `/channel/x`), and every platform has share and
 * marketing links that look like profiles. A rejected segment yields null rather than a bad handle —
 * a wrong handle is worse than none, because it silently attributes a stranger's history to the
 * founder.
 */
export function handleFromUrl(raw: string): { key: keyof Handles; value: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const rule = RULES.find((r) => r.host.test(url.hostname));
  if (!rule) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (!parts.length) return null;

  let value: string | undefined;
  if (rule.key === "reddit") {
    // /user/name or /u/name — a bare /r/subreddit is a community, not a person.
    const i = parts.findIndex((p) => p === "user" || p === "u");
    value = i >= 0 ? parts[i + 1] : undefined;
  } else if (rule.key === "youtube") {
    value = parts[0]?.startsWith("@")
      ? parts[0]
      : parts[0] === "channel" || parts[0] === "c" || parts[0] === "user"
        ? parts[1]
        : undefined;
  } else if (rule.key === "linkedin") {
    const i = parts.findIndex((p) => p === "in" || p === "company");
    value = i >= 0 ? parts[i + 1] : undefined;
  } else {
    value = parts[0];
  }

  if (!value) return null;
  value = value.replace(/^@/, "").trim();
  if (!value || value.length > 40 || rule.reject?.test(value)) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) return null;

  return { key: rule.key, value };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Does this handle plausibly belong to this product or its developer?
 *
 * **Precision over recall, deliberately.** A landing page links to far more than its own accounts —
 * open-source credits, embedded widgets, a designer's portfolio. Taking the most-linked GitHub URL on
 * overcast.fm yields `yui`, a JavaScript library, which would then be mined as "the founder's public
 * code" and attribute a stranger's entire history to them. A missing handle costs coverage; a wrong
 * one silently corrupts the timeline, so a candidate must look like the brand or the developer.
 */
export function isPlausible(handle: string, brand: string, developer: string | null): boolean {
  const h = slug(handle);
  if (h.length < 2) return false;

  const brandSlug = slug(brand);
  if (brandSlug.length >= 3 && (h.includes(brandSlug) || brandSlug.includes(h))) return true;

  if (developer) {
    const dev = slug(developer.replace(/\b(ltd|llc|inc|gmbh|limited|corp|co|apps?|software|studios?)\b/gi, ""));
    if (dev.length >= 4 && (h.includes(dev) || dev.includes(h))) return true;
    // A person's name split across the handle, e.g. "Sebastian Roehl" → sebastianroehl.
    const parts = developer.split(/\s+/).map(slug).filter((p) => p.length >= 3);
    if (parts.length >= 2 && parts.every((p) => h.includes(p))) return true;
  }

  return false;
}

export interface HandleScan {
  handles: Handles;
  /** Candidates that looked like accounts but matched neither brand nor developer. */
  rejected: string[];
}

export function handlesFromHtml(html: string, brand: string, developer: string | null): HandleScan {
  const handles: Handles = {};
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    const hit = handleFromUrl(m[0]);
    if (!hit) continue;

    const k = `${hit.key}:${hit.value}`;
    if (seen.has(k)) continue;
    seen.add(k);

    if (!isPlausible(hit.value, brand, developer)) {
      rejected.push(k);
      continue;
    }
    if (!handles[hit.key]) handles[hit.key] = hit.value;
  }

  return { handles, rejected };
}

/**
 * Discover handles for a domain. Never throws — a site that is down costs us Axis B, not the crawl.
 */
export async function discoverHandles(
  domain: string,
  ctx: Ctx,
  developer: string | null = null,
): Promise<Handles> {
  const found: Handles = {};
  const brand = domain.split(".")[0];

  for (const path of CANDIDATE_PATHS) {
    try {
      const html = await ctx.fetchText(`https://${domain}${path}`);
      for (const [k, v] of Object.entries(handlesFromHtml(html, brand, developer).handles)) {
        if (!found[k as keyof Handles]) found[k as keyof Handles] = v;
      }
      // The homepage footer usually carries everything; stop early rather than spend more requests.
      if (Object.keys(found).length >= 2) break;
    } catch {
      // A missing /about is the norm, not an error.
    }
  }

  return found;
}
