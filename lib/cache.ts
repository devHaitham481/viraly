/**
 * Persistent HTTP cache — what makes a second crawl near-free.
 *
 * This project's founding observation is that history is immutable: HabitKit's February 2023
 * Product Hunt launch will never change, and neither will a Wayback capture taken at a fixed
 * timestamp. Fetching those twice is pure waste, and the waste is expensive here because
 * archive.org throttles by IP and has cut us off twice.
 *
 * So: cache by URL, with the TTL decided by whether the URL *can* change.
 *   - a dated capture           → immutable, cached forever
 *   - a CDX index               → new captures appear, short TTL
 *   - a live lookup or search   → changes daily
 *
 * Wraps a `Ctx` rather than replacing it, so the offline suite is untouched — `replayCtx` never sees
 * this, and the rate limiter still sits underneath for anything that genuinely needs fetching.
 */

import type postgres from "postgres";
import { db } from "./db/index.ts";
import type { Ctx } from "./fetcher.ts";

/** A capture at a fixed timestamp is the same bytes forever. */
const IMMUTABLE = [/web\.archive\.org\/web\/\d{8,14}(id_)?\//];

const TTL_SECONDS: { pattern: RegExp; ttl: number }[] = [
  // The index grows as new captures are taken, but slowly.
  { pattern: /cdx\/search\/cdx/, ttl: 7 * 86_400 },
  // Rating counts and version history move daily; that is the point of them.
  { pattern: /itunes\.apple\.com/, ttl: 6 * 3_600 },
  { pattern: /hn\.algolia\.com/, ttl: 86_400 },
  { pattern: /api\.github\.com/, ttl: 86_400 },
];

const DEFAULT_TTL = 86_400;

export function isImmutable(url: string): boolean {
  return IMMUTABLE.some((re) => re.test(url));
}

export function ttlFor(url: string): number {
  if (isImmutable(url)) return Infinity;
  return TTL_SECONDS.find((r) => r.pattern.test(url))?.ttl ?? DEFAULT_TTL;
}

export interface CacheStats {
  hits: number;
  misses: number;
  bytesServed: number;
}

/**
 * Wrap a Ctx so fetches are served from Postgres when they can be.
 *
 * A cache read that fails for any reason falls through to the network — a broken cache must degrade
 * to "slow", never to "wrong" or "down".
 */
export function cachedCtx(inner: Ctx, stats: CacheStats, sql: postgres.Sql = db()): Ctx {
  return {
    ...inner,
    async fetchText(url) {
      const ttl = ttlFor(url);

      try {
        const rows = await sql<{ body: string; age: number }[]>`
          SELECT body, extract(epoch FROM (now() - fetched_at))::float AS age
            FROM http_cache WHERE url = ${url}`;
        const row = rows[0];
        if (row && (ttl === Infinity || row.age < ttl)) {
          stats.hits++;
          stats.bytesServed += row.body.length;
          return row.body;
        }
      } catch {
        // Cache unavailable — fetch it.
      }

      const body = await inner.fetchText(url);
      stats.misses++;

      try {
        await sql`
          INSERT INTO http_cache (url, body, bytes)
          VALUES (${url}, ${body}, ${body.length})
          ON CONFLICT (url) DO UPDATE
            SET body = EXCLUDED.body, bytes = EXCLUDED.bytes, fetched_at = now()`;
      } catch {
        // A failed write costs a future cache hit, nothing more.
      }

      return body;
    },
  };
}

export const newStats = (): CacheStats => ({ hits: 0, misses: 0, bytesServed: 0 });
