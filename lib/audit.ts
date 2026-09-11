/**
 * Invariants — the checks that survive an app we have never seen.
 *
 * Every correctness bug this project has hit was silent: nothing threw, nothing looked malformed,
 * and the output was a plausible, confident, wrong timeline. A page's `versionHistory` belonging to
 * a different app. A milestone asserted from data that starts a decade late. A billing period read
 * from the neighbouring offer.
 *
 * Unit tests cannot catch that class, because they assert known-good values for one known app. These
 * assert *properties that must hold for any app*, and they run on every crawl — so a violation on an
 * unfamiliar target lands in the coverage report rather than in a chart someone believes.
 */

import type { Event, Metric } from "./schema.ts";

export interface Violation {
  rule: string;
  detail: string;
  /** `error` — the output is wrong. `warn` — suspicious, may be legitimate. */
  level: "error" | "warn";
}

/** The App Store opened in July 2008; nothing app-related predates it. */
const EPOCH = "2008-07-10";

/** Cumulative series that can only ever go up. */
const MONOTONIC = new Set(["ios_rating_count", "play_installs"]);

export function auditCrawl(
  events: Event[],
  metrics: Metric[],
  opts: { today?: string } = {},
): Violation[] {
  const v: Violation[] = [];
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const push = (rule: string, detail: string, level: Violation["level"] = "error") =>
    v.push({ rule, detail, level });

  // ---- dates ----------------------------------------------------------------
  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) push("date_format", `${e.source}: "${e.date}"`);
    else if (e.date < EPOCH) push("date_before_epoch", `${e.source} ${e.date}: ${e.title}`);
    else if (e.date > today) push("date_in_future", `${e.source} ${e.date}: ${e.title}`);
  }
  for (const m of metrics) {
    if (m.date < EPOCH || m.date > today) push("metric_date_range", `${m.metric} ${m.date}`);
  }

  // ---- evidence -------------------------------------------------------------
  for (const e of events) {
    if (!/^https?:\/\//.test(e.url)) push("evidence_url", `${e.source}: "${e.url}"`);
    // A raw Wayback capture renders unstyled and broken; links must be the replay form.
    if (e.url.includes("id_/")) push("raw_capture_link", `${e.source}: ${e.url}`);
  }

  // ---- cumulative series may not fall ---------------------------------------
  const series = new Map<string, { date: string; value: number }[]>();
  for (const m of metrics) {
    if (typeof m.value !== "number") continue;
    const list = series.get(m.metric) ?? [];
    list.push({ date: m.date, value: m.value });
    series.set(m.metric, list);
  }
  for (const [name, list] of series) {
    if (!MONOTONIC.has(name)) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < list.length; i++) {
      if (list[i].value < list[i - 1].value) {
        // The signature of parsing another app's page, or of mixing two crawls together.
        push(
          "series_decreased",
          `${name} fell ${list[i - 1].value} → ${list[i].value} at ${list[i].date}`,
        );
      }
    }
  }

  // ---- one product, one version family --------------------------------------
  const majors = new Set(
    events
      .map((e) => /^Version (\d+)\./.exec(e.title)?.[1])
      .filter((x): x is string => x !== undefined),
  );
  if (majors.size > 3) {
    // Regression signature: a store page embeds the version history of every app it links to.
    push("version_families", `${majors.size} distinct major versions: ${[...majors].join(", ")}`);
  }

  // ---- no duplicates --------------------------------------------------------
  const seen = new Set<string>();
  for (const e of events) {
    const key = `${e.date}|${e.source}|${e.title}`;
    if (seen.has(key)) push("duplicate_event", `${e.date} ${e.title}`, "warn");
    seen.add(key);
  }

  // ---- ordering claims ------------------------------------------------------
  const launch = events.find((e) => e.kind === "launch");
  if (launch) {
    for (const e of events) {
      if (e.source === "appstore" && e.date < launch.date) {
        push("store_event_before_launch", `${e.date}: ${e.title}`, "warn");
      }
    }
  }

  // ---- archive.org served us its own page instead of the site ---------------
  for (const e of events) {
    if (/wayback machine|internet archive|page is not available/i.test(e.title)) {
      push("archive_interstitial", `${e.date}: ${e.title}`);
    }
  }

  // ---- a source that returns nothing where it usually returns a lot ----------
  const bySource = new Map<string, number>();
  for (const e of events) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
  if ((bySource.get("appstore") ?? 0) > 0 && series.get("ios_rating_count") === undefined) {
    push("appstore_no_growth", "App Store events but no rating series — the JSON-LD may have moved");
  }

  return v;
}
