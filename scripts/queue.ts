/**
 * Live queue overview. `npm run queue` (add --watch to refresh).
 *
 * Reads the same `source_runs` rows the worker claims and the UI renders — there is no separate
 * telemetry to drift out of sync.
 */

import { db } from "../lib/db/index.ts";

interface Row {
  name: string; source: string; status: string; note: string | null;
  progress: string | null; elapsed: number | null; events: number; metrics: number;
}

const PAD = { name: 30, source: 11, status: 8 };
const DOT: Record<string, string> = {
  ok: "\x1b[32m●\x1b[0m", empty: "\x1b[90m○\x1b[0m", partial: "\x1b[33m◐\x1b[0m",
  failed: "\x1b[31m✖\x1b[0m", running: "\x1b[36m▸\x1b[0m", queued: "\x1b[90m·\x1b[0m",
};

async function render() {
  const rows = await db()<Row[]>`
    SELECT t.name, r.source, r.status, r.note, r.progress,
           round(extract(epoch from (now() - r.started_at)))::int AS elapsed,
           (SELECT count(*) FROM events  e WHERE e.crawl_id = r.crawl_id AND e.source = r.source) AS events,
           (SELECT count(*) FROM metrics m WHERE m.crawl_id = r.crawl_id) AS metrics
      FROM source_runs r
      JOIN crawls c ON c.id = r.crawl_id
      JOIN targets t ON t.ios_id = c.ios_id
     WHERE c.created_at > now() - interval '30 minutes'
     ORDER BY c.created_at DESC, r.id`;

  const pending = rows.filter((r) => r.status === "queued" || r.status === "running").length;
  const out: string[] = [
    `\n  ${rows.length} runs in the last 30 min · ${pending} pending\n`,
    `  ${"target".padEnd(PAD.name)} ${"source".padEnd(PAD.source)} ${"status".padEnd(PAD.status)} detail`,
    `  ${"─".repeat(PAD.name)} ${"─".repeat(PAD.source)} ${"─".repeat(PAD.status)} ${"─".repeat(44)}`,
  ];

  let lastName = "";
  for (const r of rows) {
    const detail =
      r.status === "running"
        ? `${r.progress ?? "started"}${r.elapsed != null ? ` (${r.elapsed}s)` : ""}`
        : r.status === "queued"
          ? "waiting for a worker"
          : `${r.note ?? ""}${r.events ? `  [${r.events} events]` : ""}`;
    const label = r.name === lastName ? "" : r.name.slice(0, PAD.name);
    lastName = r.name;
    out.push(
      `  ${label.padEnd(PAD.name)} ${r.source.padEnd(PAD.source)} ${DOT[r.status] ?? " "} ${r.status.padEnd(PAD.status - 2)} ${detail.slice(0, 60)}`,
    );
  }
  return out.join("\n");
}

const watch = process.argv.includes("--watch");
if (watch) {
  for (;;) {
    process.stdout.write("\x1b[2J\x1b[H" + (await render()) + "\n");
    await new Promise((r) => setTimeout(r, 1500));
  }
} else {
  console.log(await render());
  await db().end();
}
