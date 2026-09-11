/**
 * The contract.
 *
 * Every source module in `lib/sources/` produces these shapes and nothing else. Mirrors
 * `shape.json`, which is the verified HabitKit fixture and the spec for this file.
 *
 * Deliberately absent: `confidence`, `eras`, `edges`, `findings`. All deferred (PRD §4) — they are
 * analysis layered on top of a complete event list, and the list has to exist first.
 */

/** What kind of move an event represents. The 8 values from `shape.json._kinds`. */
export type EventKind =
  | "launch" // PH, Show HN, app store release
  | "own_content" // their blog post, their video, their newsletter
  | "community_post" // founder posting in reddit/IH/forums/discord
  | "earned_media" // podcast guest, press article, someone else's review
  | "mention" // anyone else writing/talking about it, unprompted
  | "paid_ads" // meta/tiktok ad library entries
  | "aso" // app store title/keyword changes
  | "product_change"; // pricing, positioning, feature

/** Which source produced a row. Grows one entry per source module. */
export type SourceId =
  | "itunes"
  | "wayback"
  | "hackernews"
  | "producthunt"
  | "reddit"
  | "podcast"
  | "appstore"
  | "playstore"
  | "blog"
  | "github";

/**
 * Accounts belonging to the product or its founder.
 *
 * Resolving these is Axis B's bottleneck: one handle unlocks a whole posting history, and until it
 * is known every founder-side source is blocked (PRD §7).
 */
export interface Handles {
  x?: string;
  github?: string;
  reddit?: string;
  youtube?: string;
  linkedin?: string;
  instagram?: string;
  mastodon?: string;
}

/** One thing that happened, on a date, with evidence. */
export interface Event {
  /** ISO date, `YYYY-MM-DD`. A plain string: sorting a timeline is all we need it for. */
  date: string;
  kind: EventKind;
  title: string;
  source: SourceId;
  /** Who did it. `null` when the source cannot attribute it. */
  by: string | null;
  /** Did the product's own side do this, or did someone else? */
  by_founder: boolean;
  /** Real, fetched evidence URL. Never a placeholder — see REVIEW.md rule #1. */
  url: string;
  /** Whatever that source counts: upvotes, points, score. `null` when it counts nothing. */
  number: number | null;
  /** `false` when the date is inferred or bracketed (e.g. a Wayback diff) rather than stated. */
  date_exact: boolean;
}

/** One dated public number, for the growth curve. */
export interface Metric {
  date: string;
  /** e.g. `ios_rating_count`, `play_installs`. */
  metric: string;
  /** Numbers where we have them, strings for brackets like `"100000+"`. */
  value: number | string;
  url: string;
}

/**
 * What was actually looked at.
 *
 * Load-bearing, not bookkeeping (PRD §5): a chronological timeline makes absence look like fact, and
 * this is what distinguishes "they went quiet" from "the crawler failed". Every source writes a row
 * on success *and* failure. At E2 this becomes the job table itself — one row per (target, source).
 */
export interface Coverage {
  source: SourceId;
  /**
   * Five outcomes and two pending states, kept distinct because collapsing any pair produces a
   * confident falsehood:
   *   `ok` we looked and found things · `partial` we looked, some of it was unreadable ·
   *   `empty` we looked and there is genuinely nothing · `failed` we could not look ·
   *   `blocked` we had nothing to look *with* (a prerequisite never resolved) ·
   *   `queued` / `running` we have not finished looking.
   */
  status: "queued" | "running" | "ok" | "failed" | "partial" | "empty" | "blocked";
  note?: string;
  /** Live progress from a long-running source, e.g. "12/24 captures". */
  progress?: string | null;
  /** Seconds since this source started, while it is running. */
  elapsed_s?: number | null;
}

/** The resolved subject. Everything else keys off this, so getting it wrong is the top risk (PRD §9.1). */
export interface AppIdentity {
  name: string;
  domain: string | null;
  ios_id: string;
  play_id: string | null;
  founder: string | null;
  /** How the founder was resolved, so a wrong attribution is traceable. */
  founder_source: string | null;
  artwork: string | null;
  /** Canonical App Store URL, from iTunes. The slug matters — archived captures are keyed by it. */
  store_url: string | null;
  /** Discovered accounts. Empty until handle resolution runs; see lib/handles.ts. */
  handles: Handles;
}

/** One candidate in the disambiguation step (D3). Enough detail to tell two same-named apps apart. */
export interface Candidate {
  ios_id: string;
  name: string;
  developer: string;
  domain: string | null;
  released: string;
  rating_count: number;
  rating_avg: number | null;
  artwork: string | null;
  store_url: string;
}

/** What a crawl returns. `shape.json` is an instance of this. */
export interface CrawlResult {
  app: AppIdentity;
  events: Event[];
  metrics: Metric[];
  coverage: Coverage[];
}
