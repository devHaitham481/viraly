/**
 * Global per-host token bucket, in Postgres.
 *
 * Must be shared across processes, not per-worker: archive.org throttles by IP, so two concurrent
 * crawls drawing from separate in-memory buckets would 429 each other. That is not hypothetical —
 * it happened during research (PRD §9.9), and previously-working queries began failing.
 *
 * One atomic statement does refill and spend together, so no locking is needed beyond the row.
 */

import type postgres from "postgres";
import { db } from "../db/index.ts";

export interface HostPolicy {
  capacity: number;
  refillPerSec: number;
}

/**
 * Deliberately conservative where it matters. archive.org is the spine of the product and the one
 * host that has already cut us off; it gets one request every two seconds, no burst worth the name.
 */
export const POLICIES: Record<string, HostPolicy> = {
  "web.archive.org": { capacity: 3, refillPerSec: 0.5 },
  "archive.org": { capacity: 3, refillPerSec: 0.5 },
  "itunes.apple.com": { capacity: 10, refillPerSec: 2 },
  "apps.apple.com": { capacity: 5, refillPerSec: 1 },
  "hn.algolia.com": { capacity: 10, refillPerSec: 2 },
  default: { capacity: 5, refillPerSec: 1 },
};

export function policyFor(host: string): HostPolicy {
  return POLICIES[host] ?? POLICIES.default;
}

/** Try to spend one token. Returns true on success, false if the bucket is dry. */
export async function trySpend(host: string, sql: postgres.Sql = db()): Promise<boolean> {
  const p = policyFor(host);

  await sql`
    INSERT INTO host_buckets (host, tokens, capacity, refill_per_sec)
    VALUES (${host}, ${p.capacity}, ${p.capacity}, ${p.refillPerSec})
    ON CONFLICT (host) DO NOTHING`;

  const rows = await sql`
    UPDATE host_buckets SET
      tokens = LEAST(capacity, tokens + EXTRACT(EPOCH FROM (now() - updated_at)) * refill_per_sec) - 1,
      updated_at = now()
    WHERE host = ${host}
      AND LEAST(capacity, tokens + EXTRACT(EPOCH FROM (now() - updated_at)) * refill_per_sec) >= 1
    RETURNING tokens`;

  return rows.length > 0;
}

/**
 * Block until a token is available for `host`.
 *
 * Polls rather than using LISTEN/NOTIFY: at these rates the wait is seconds, and a poll loop has no
 * connection state to lose. `timeoutMs` exists so a starved worker reports failure instead of
 * hanging a crawl forever.
 */
export async function acquire(host: string, timeoutMs = 120_000, sql?: postgres.Sql): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let wait = 150;
  while (Date.now() < deadline) {
    if (await trySpend(host, sql)) return;
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 1.5, 2_000);
  }
  throw new Error(`rate limiter: no token for ${host} within ${timeoutMs}ms`);
}
