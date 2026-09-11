/**
 * The worker.
 *
 * Claims queued `source_runs` with `FOR UPDATE SKIP LOCKED` — the standard Postgres queue primitive.
 * No queue library: our job rows double as the user-facing coverage report, and a library would own
 * its own tables, leaving two sources of truth for what a crawl actually did (PRD §12.2).
 *
 * Generic on purpose. It knows nothing about any particular source — it reads the registry, draws a
 * rate-limit token per host, runs `collect`, and records the outcome. Adding a source never touches
 * this file.
 *
 * Run several: `npm run worker` in as many terminals as you like. The limiter is global, so more
 * workers means more parallelism across hosts, not more requests per host.
 */

import { applySchema, db } from "../lib/db/index.ts";
import { acquire } from "../lib/queue/limiter.ts";
import { writeResults } from "../lib/crawl.ts";
import { liveCtx } from "../lib/fetcher.ts";
import { cachedCtx, newStats } from "../lib/cache.ts";
import { sourceById } from "../lib/sources/registry.ts";
import type { AppIdentity } from "../lib/schema.ts";

const IDLE_MS = 1_000;
const MAX_ATTEMPTS = 3;

interface Claim {
  id: string;
  crawl_id: string;
  source: string;
  attempts: number;
  app: AppIdentity;
}

/** Atomically take one queued run. Returns null when there is nothing to do. */
async function claim(): Promise<Claim | null> {
  const sql = db();
  const rows = await sql<Claim[]>`
    WITH next AS (
      SELECT id FROM source_runs
      WHERE status = 'queued' AND run_after <= now()
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE source_runs r
       SET status = 'running', attempts = r.attempts + 1, started_at = now()
      FROM next, crawls c, targets t
     WHERE r.id = next.id AND c.id = r.crawl_id AND t.ios_id = c.ios_id
 RETURNING r.id, r.crawl_id, r.source, r.attempts,
           jsonb_build_object(
             'ios_id', t.ios_id, 'name', t.name, 'domain', t.domain, 'play_id', t.play_id,
             'founder', t.founder, 'founder_source', t.founder_source, 'artwork', t.artwork,
             'store_url', t.store_url, 'handles', t.handles
           ) AS app`;
  return rows[0] ?? null;
}

async function runOne(job: Claim): Promise<void> {
  const sql = db();
  const source = sourceById(job.source);

  if (!source) {
    await sql`UPDATE source_runs SET status='failed', note=${`unknown source ${job.source}`},
              finished_at=now() WHERE id=${job.id}`;
    return;
  }

  const started = Date.now();
  try {
    // One token per host before the source is allowed to run at all.
    for (const host of source.hosts) await acquire(host);

    // Progress is written straight to the run row, so the coverage report and the live view stay
    // the same object. Fire-and-forget: a failed progress write must never fail the crawl.
    let lastWrite = 0;
    const progress = (note: string) => {
      const now = Date.now();
      if (now - lastWrite < 700) return;
      lastWrite = now;
      sql`UPDATE source_runs SET progress = ${note} WHERE id = ${job.id}`.catch(() => {});
    };

    // Cache in front of the limiter: a hit must not spend a token, or a fully cached re-crawl
    // would still wait out two minutes of throttling for requests it never makes.
    const stats = newStats();
    const { events, metrics, coverage } = await source.collect(
      job.app,
      cachedCtx(liveCtx({ acquire, timeoutMs: 45_000, progress }), stats),
    );
    const cacheNote =
      stats.hits + stats.misses > 0
        ? ` · ${stats.hits}/${stats.hits + stats.misses} cached`
        : "";
    await writeResults(job.crawl_id, source.id, events, metrics);
    await sql`UPDATE source_runs SET status=${coverage.status},
              note=${(coverage.note ?? "") + cacheNote}, progress=null, finished_at=now()
              WHERE id=${job.id}`;
    console.log(
      `  ${source.id.padEnd(12)} ${coverage.status.padEnd(7)} ${events.length}e ${metrics.length}m  ` +
        `${Date.now() - started}ms  cache ${stats.hits}/${stats.hits + stats.misses}`,
    );
  } catch (err) {
    // A source that throws is a bug in that source — `collect` is contracted never to. Retry a
    // couple of times in case it was transient, then record the failure and move on. A crawl must
    // not be taken down by one broken source.
    const note = err instanceof Error ? err.message : String(err);
    const giveUp = job.attempts >= MAX_ATTEMPTS;
    await sql`
      UPDATE source_runs
         SET status = ${giveUp ? "failed" : "queued"},
             note = ${note},
             run_after = now() + ${`${2 ** job.attempts * 5} seconds`}::interval,
             finished_at = ${giveUp ? sql`now()` : null}
       WHERE id = ${job.id}`;
    console.log(`  ${source.id.padEnd(12)} ${giveUp ? "failed " : "retry  "} ${note}`);
  }
}

async function main() {
  await applySchema();
  console.log("worker ready");

  let idle = false;
  for (;;) {
    // Liveness, not progress: the app needs to distinguish "nothing is processing this" from
    // "this is slow". Cheap enough to write on every poll.
    await db()`
      INSERT INTO worker_heartbeat (id, beat_at) VALUES (1, now())
      ON CONFLICT (id) DO UPDATE SET beat_at = now()`.catch(() => {});

    const job = await claim();
    if (!job) {
      if (!idle) {
        console.log("idle");
        idle = true;
      }
      await new Promise((r) => setTimeout(r, IDLE_MS));
      continue;
    }
    idle = false;
    await runOne(job);
  }
}

main().catch((err) => {
  console.error("worker died:", err);
  process.exit(1);
});
