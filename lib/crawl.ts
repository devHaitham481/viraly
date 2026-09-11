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
import { lookupApp } from "./sources/itunes.ts";
import { SOURCES, missingNeeds } from "./sources/registry.ts";
import type { AppIdentity, Coverage, CrawlResult, Event, Metric } from "./schema.ts";

export const workerCtx = () => liveCtx({ acquire });

export interface CrawlProgress extends CrawlResult {
  crawl_id: string;
  pending: number;
}

/** Resolve identity, persist it, and queue the rest. Returns the crawl id immediately. */
export async function createCrawl(iosId: string): Promise<string> {
  const sql = db();
  const itunes = await lookupApp(iosId, workerCtx());
  const a = itunes.app;

  await sql`
    INSERT INTO targets ${sql({
      ios_id: a.ios_id, name: a.name, domain: a.domain, play_id: a.play_id,
      founder: a.founder, founder_source: a.founder_source, artwork: a.artwork,
    })}
    ON CONFLICT (ios_id) DO UPDATE SET
      name = EXCLUDED.name, domain = EXCLUDED.domain, play_id = EXCLUDED.play_id,
      founder = EXCLUDED.founder, founder_source = EXCLUDED.founder_source,
      artwork = EXCLUDED.artwork`;

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
      await sql`
        INSERT INTO source_runs (crawl_id, source, status, note, finished_at)
        VALUES (${crawlId}, ${s.id}, 'empty', ${`skipped — no ${missing.join(", ")}`}, now())`;
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
    SELECT t.ios_id, t.name, t.domain, t.play_id, t.founder, t.founder_source, t.artwork
    FROM crawls c JOIN targets t USING (ios_id) WHERE c.id = ${crawlId}`;
  if (!target) return null;

  const [events, metrics, runs] = await Promise.all([
    sql`SELECT to_char(date,'YYYY-MM-DD') AS date, kind, title, source, by_who, by_founder, url,
               number, date_exact
        FROM events WHERE crawl_id = ${crawlId} ORDER BY date, id`,
    sql`SELECT to_char(date,'YYYY-MM-DD') AS date, metric, value, url
        FROM metrics WHERE crawl_id = ${crawlId} ORDER BY date, id`,
    sql`SELECT source, status, note FROM source_runs WHERE crawl_id = ${crawlId} ORDER BY source`,
  ]);

  return {
    crawl_id: crawlId,
    app: target,
    events: events.map((e) => ({
      date: e.date, kind: e.kind, title: e.title, source: e.source,
      by: e.by_who, by_founder: e.by_founder, url: e.url,
      number: e.number === null ? null : Number(e.number), date_exact: e.date_exact,
    })) as Event[],
    metrics: metrics.map((m) => ({
      date: m.date, metric: m.metric,
      value: /^\d+$/.test(m.value) ? Number(m.value) : m.value, url: m.url,
    })) as Metric[],
    // The queue IS the coverage report. Same rows, no second source of truth.
    coverage: runs.map((r) => ({
      source: r.source, status: r.status === "queued" || r.status === "running" ? "partial" : r.status,
      note: r.status === "queued" ? "queued" : r.status === "running" ? "running…" : r.note,
    })) as Coverage[],
    pending: runs.filter((r) => r.status === "queued" || r.status === "running").length,
  };
}
