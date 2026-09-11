/**
 * Age-normalized comparison.
 *
 * Plotting two apps by calendar date compares an app launched in 2019 with one launched last year
 * and says nothing. Plotting by *months since launch* asks the only question a founder mid-launch
 * actually has: **here is you at month 7, here is them at month 7.**
 *
 * Needs no new sources — every input is already in the database.
 */

import { db } from "./db/index.ts";
import { readCrawl } from "./crawl.ts";
import type { Insights } from "./insights.ts";

export interface TargetSummary {
  ios_id: string;
  name: string;
  artwork: string | null;
  crawl_id: string;
  crawled_at: string;
  events: number;
}

/** Everything crawled so far, newest crawl per target. Only these can be compared. */
export async function listTargets(): Promise<TargetSummary[]> {
  return db()<TargetSummary[]>`
    SELECT DISTINCT ON (t.ios_id)
           t.ios_id, t.name, t.artwork,
           c.id AS crawl_id, c.created_at AS crawled_at,
           (SELECT count(*)::int FROM events e WHERE e.crawl_id = c.id) AS events
      FROM crawls c
      JOIN targets t USING (ios_id)
     WHERE NOT EXISTS (
             SELECT 1 FROM source_runs r
              WHERE r.crawl_id = c.id AND r.status IN ('queued', 'running'))
     ORDER BY t.ios_id, c.created_at DESC`;
}

export interface Comparison {
  ios_id: string;
  name: string;
  artwork: string | null;
  insights: Insights;
}

/** Load insights for several targets, using each one's most recent finished crawl. */
export async function compareTargets(iosIds: string[]): Promise<Comparison[]> {
  const all = await listTargets();
  const wanted = all.filter((t) => iosIds.includes(t.ios_id));

  const out: Comparison[] = [];
  for (const t of wanted) {
    const crawl = await readCrawl(t.crawl_id);
    if (!crawl?.insights.launch_date) continue;
    out.push({ ios_id: t.ios_id, name: t.name, artwork: t.artwork, insights: crawl.insights });
  }
  return out;
}
