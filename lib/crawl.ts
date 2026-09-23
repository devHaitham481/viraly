/**
 * Creating and reading a crawl.
 *
 * A crawl is created synchronously — iTunes resolves the identity in one call, so the user sees a
 * real result immediately — and everything else is queued for the worker. That split is why the UI
 * can fill in progressively instead of showing a spinner for minutes (PRD §12).
 */

import { db } from "./db/index.ts";
import { liveCtx } from "./fetcher.ts";
import { acquire } from "./queue/limiter.ts";
import { cachedCtx, newStats, type CacheStats } from "./cache.ts";
import { lookupApp } from "./sources/itunes.ts";
import { discoverHandles } from "./handles.ts";
import { SOURCES, missingNeeds } from "./sources/registry.ts";
import type { AppIdentity, Coverage, CrawlResult, Event, Metric } from "./schema.ts";
import { computeInsights, type Insights } from "./insights.ts";
import { auditCrawl, type Violation } from "./audit.ts";
import { attributionSummary, buildSteps, buildTimeline, type Step, type TimelineEntry } from "./impact.ts";
import { buildBrief, type Brief } from "./brief.ts";

// 45s, not the 15s default: archive.org's CDX endpoint routinely takes 12s+ and a tighter timeout
// silently drops the capture index — which is how the first recording run lost it.
/**
 * The context every fetching path uses: cache in front, rate limiter behind.
 *
 * Order matters — a cache hit must not spend a token, or a fully cached re-crawl would still take
 * two minutes of waiting for requests it never makes.
 */
export function workerCtx(stats: CacheStats = newStats()) {
  return cachedCtx(liveCtx({ acquire, timeoutMs: 45_000 }), stats);
}

export interface CrawlProgress extends CrawlResult {
  crawl_id: string;
  pending: number;
  /** Source-runs from *other* crawls queued ahead of this one. Explains a slow start honestly. */
  queue_ahead: number;
  /** Derived from the rows above — no extra fetching. See lib/insights.ts. */
  insights: Insights;
  /** Invariant violations. Empty is the expected case; anything here means the output is suspect. */
  violations: Violation[];
  /** False when no worker has checked in recently — queued work will never be picked up. */
  worker_alive: boolean;
  /** Sources this app knows that the running worker does not — it is running older code. */
  worker_missing: string[];
  /** Events with growth context attached. See lib/impact.ts. */
  timeline: TimelineEntry[];
  /** The same events grouped into steps the growth data can actually distinguish. */
  steps: Step[];
  /** What the timeline as a whole actually supports. */
  attribution: string;
  /** The written summary. Deterministic — see lib/brief.ts. */
  brief: Brief;
}

/** Resolve identity, persist it, and queue the rest. Returns the crawl id immediately. */
export async function createCrawl(iosId: string): Promise<string> {
  const sql = db();
  const ctx = workerCtx();
  const itunes = await lookupApp(iosId, ctx);
  const a = itunes.app;

  // Handle discovery runs here, not as a queued source: everything on Axis B depends on it, and the
  // worker has no dependency ordering. One extra fetch buys that simplicity (lib/handles.ts).
  if (a.domain) {
    const found = await discoverHandles(a.domain, ctx, a.founder);
    a.handles = found.handles;
    // A package stated by the product's own Play badge beats one inferred from the iOS bundle id.
    if (found.playPackage) a.play_id = found.playPackage;
  }

  // A failed lookup returns a blank identity, and upserting it would overwrite the stored row for
  // *every past crawl* of this app — Monday's good crawl would start rendering with no name and no
  // developer, with nothing to say why. A transient 503 must not destroy known-good data.
  if (itunes.coverage.status !== "ok") {
    const [existing] = await sql<{ ios_id: string }[]>`
      SELECT ios_id FROM targets WHERE ios_id = ${iosId}`;
    if (!existing) {
      throw new Error(
        `could not resolve ${iosId} from the App Store (${itunes.coverage.note ?? "unknown error"})`,
      );
    }
    // Keep what we know; record the crawl anyway so the failure is visible in coverage.
    const [{ id }] = await sql<{ id: string }[]>`
      INSERT INTO crawls (ios_id) VALUES (${iosId}) RETURNING id`;
    await sql`
      INSERT INTO source_runs (crawl_id, source, status, note, attempts, finished_at)
      VALUES (${id}, 'itunes', ${itunes.coverage.status}, ${itunes.coverage.note ?? null}, 1, now())`;
    for (const s of SOURCES) {
      await sql`
        INSERT INTO source_runs (crawl_id, source, status, note, finished_at)
        VALUES (${id}, ${s.id}, 'blocked', 'identity could not be refreshed', now())`;
    }
    return id;
  }

  await sql`
    INSERT INTO targets ${sql({
      ios_id: a.ios_id, name: a.name, domain: a.domain, play_id: a.play_id,
      founder: a.founder, founder_source: a.founder_source, artwork: a.artwork,
      store_url: a.store_url, handles: sql.json(a.handles as Record<string, string>),
    })}
    ON CONFLICT (ios_id) DO UPDATE SET
      name = EXCLUDED.name, domain = EXCLUDED.domain, play_id = EXCLUDED.play_id,
      founder = EXCLUDED.founder, founder_source = EXCLUDED.founder_source,
      artwork = EXCLUDED.artwork, store_url = EXCLUDED.store_url,
      handles = EXCLUDED.handles`;

  const [{ id: crawlId }] = await sql<{ id: string }[]>`
    INSERT INTO crawls (ios_id) VALUES (${iosId}) RETURNING id`;

  await writeResults(crawlId, "itunes", itunes.events, itunes.metrics);
  await sql`
    INSERT INTO source_runs (crawl_id, source, status, note, attempts, finished_at)
    VALUES (${crawlId}, 'itunes', ${itunes.coverage.status}, ${itunes.coverage.note ?? null}, 1, now())`;

  // Queue the rest. A source whose prerequisites are missing is recorded now rather than run.
  for (const s of SOURCES) {
    const missing = missingNeeds(s, a);
    if (missing.length) {
      // `blocked`, not `empty`: we had nothing to look *with*. `empty` means we looked and there is
      // genuinely nothing, and collapsing the two would report "this founder has no GitHub" when
      // the truth is that their site was unreachable for thirty seconds.
      await sql`
        INSERT INTO source_runs (crawl_id, source, status, note, finished_at)
        VALUES (${crawlId}, ${s.id}, 'blocked', ${`no ${missing.join(", ")} resolved`}, now())`;
    } else {
      await sql`INSERT INTO source_runs (crawl_id, source) VALUES (${crawlId}, ${s.id})`;
    }
  }

  return crawlId;
}

export async function writeResults(
  crawlId: string,
  source: string,
  events: Event[],
  metrics: Metric[],
): Promise<void> {
  const sql = db();
  if (events.length) {
    await sql`INSERT INTO events ${sql(
      events.map((e) => ({
        crawl_id: crawlId, date: e.date, kind: e.kind, title: e.title, source,
        by_who: e.by, by_founder: e.by_founder, url: e.url, number: e.number,
        date_exact: e.date_exact,
      })),
    )}`;
  }
  if (metrics.length) {
    await sql`INSERT INTO metrics ${sql(
      metrics.map((m) => ({
        crawl_id: crawlId, date: m.date, metric: m.metric,
        value: String(m.value), url: m.url,
      })),
    )}`;
  }
}

/** Everything known about a crawl right now, finished or not. */
export async function readCrawl(crawlId: string): Promise<CrawlProgress | null> {
  const sql = db();
  const [target] = await sql<AppIdentity[]>`
    SELECT t.ios_id, t.name, t.domain, t.play_id, t.founder, t.founder_source, t.artwork,
           t.store_url, t.handles
    FROM crawls c JOIN targets t USING (ios_id) WHERE c.id = ${crawlId}`;
  if (!target) return null;

  const [events, metrics, runs] = await Promise.all([
    sql`SELECT to_char(date,'YYYY-MM-DD') AS date, kind, title, source, by_who, by_founder, url,
               number, date_exact
        FROM events WHERE crawl_id = ${crawlId} ORDER BY date, id`,
    sql`SELECT to_char(date,'YYYY-MM-DD') AS date, metric, value, url
        FROM metrics WHERE crawl_id = ${crawlId} ORDER BY date, id`,
    sql`SELECT source, status, note, progress,
               round(extract(epoch from (now() - started_at))) AS elapsed_s
        FROM source_runs WHERE crawl_id = ${crawlId} ORDER BY source`,
  ]);

  const [beat] = await sql<{ alive: boolean; sources: string[] | null }[]>`
    SELECT beat_at > now() - interval '60 seconds' AS alive, sources
      FROM worker_heartbeat WHERE id = 1`;

  // A worker started before a source was added cannot run it. Name the gap rather than let the
  // crawl report "unknown source".
  const workerKnows = new Set(beat?.sources ?? []);
  const workerMissing = beat?.sources?.length
    ? SOURCES.map((s) => s.id).filter((id) => !workerKnows.has(id))
    : [];

  const [{ ahead }] = await sql<{ ahead: number }[]>`
    SELECT count(*)::int AS ahead FROM source_runs
    WHERE status IN ('queued', 'running')
      AND crawl_id <> ${crawlId}
      AND id < COALESCE((SELECT min(id) FROM source_runs WHERE crawl_id = ${crawlId}), 0)`;

  const eventRows = events.map((e) => ({
    date: e.date, kind: e.kind, title: e.title, source: e.source,
    by: e.by_who, by_founder: e.by_founder, url: e.url,
    number: e.number === null ? null : Number(e.number), date_exact: e.date_exact,
  })) as Event[];

  const metricRows = metrics.map((m) => ({
    date: m.date, metric: m.metric,
    // Decimals must survive the round-trip through text. An integers-only test silently left
    // "1.99" and "4.85" as strings, and every numeric consumer then skipped them.
    // Bracketed values like "100000+" are meant to stay strings.
    value: /^-?\d+(\.\d+)?$/.test(m.value) ? Number(m.value) : m.value,
    url: m.url,
  })) as Metric[];

  const timeline = buildTimeline(eventRows, metricRows);
  const steps = buildSteps(eventRows, metricRows);
  const insights = computeInsights(eventRows, metricRows);

  return {
    crawl_id: crawlId,
    app: target,
    events: eventRows,
    metrics: metricRows,
    insights,
    brief: buildBrief(target.name, eventRows, metricRows, insights, steps),
    violations: auditCrawl(eventRows, metricRows),
    timeline,
    steps,
    attribution: attributionSummary(steps),
    // The queue IS the coverage report. Same rows, no second source of truth.
    coverage: runs.map((r) => ({
      source: r.source,
      status: r.status,
      note: r.note,
      progress: r.progress ?? null,
      elapsed_s: r.status === "running" && r.elapsed_s !== null ? Number(r.elapsed_s) : null,
    })) as Coverage[],
    pending: runs.filter((r) => r.status === "queued" || r.status === "running").length,
    queue_ahead: Number(ahead),
    worker_alive: beat?.alive === true,
    worker_missing: workerMissing,
  };
}
