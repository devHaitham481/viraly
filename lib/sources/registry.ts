/**
 * Sources declare themselves; the worker stays generic.
 *
 * Adding a source is one file plus one line here. The worker, the rate limiter and the coverage
 * report all pick it up without being touched — which is the only way ~15 of these stay consistent.
 */

import type { AppIdentity, Coverage, Event, Handles, Metric, SourceId } from "../schema.ts";
import type { Ctx } from "../fetcher.ts";
import { hackernews } from "./hackernews.ts";
import { wayback } from "./wayback.ts";
import { appstore } from "./appstore.ts";
import { blog } from "./blog.ts";
import { github } from "./github.ts";
import { playstore } from "./playstore.ts";

export interface SourceResult {
  events: Event[];
  metrics: Metric[];
  /** `source` is filled in by the worker — a source cannot mislabel its own rows. */
  coverage: Omit<Coverage, "source">;
}

export interface Source {
  id: SourceId;
  /** 0 free+unauthenticated · 1 free key · 2 paid · 3 logged-in browsing (PRD §7). */
  tier: 0 | 1 | 2 | 3;
  /** Hosts this source touches. The worker draws a token per host before letting it run. */
  hosts: string[];
  /**
   * Identity fields this source cannot work without. Missing → the run is recorded `empty` with the
   * reason, never `failed`. "We had nothing to look with" is not "we looked and it broke".
   */
  needs?: (keyof AppIdentity)[];
  /** A handle this source cannot work without, e.g. `github`. Same semantics as `needs`. */
  needsHandle?: keyof Handles;
  collect(app: AppIdentity, ctx: Ctx): Promise<SourceResult>;
}

/**
 * Queued sources. iTunes is deliberately absent: it is the *resolver*, runs synchronously at crawl
 * creation, and its events come free with the identity lookup.
 */
export const SOURCES: Source[] = [wayback, appstore, playstore, blog, github, hackernews];

export function sourceById(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id);
}

/** Which prerequisites are missing for this source, if any. */
export function missingNeeds(s: Source, app: AppIdentity): string[] {
  const missing: string[] = (s.needs ?? []).filter((k) => !app[k]);
  if (s.needsHandle && !app.handles?.[s.needsHandle]) missing.push(`${s.needsHandle} handle`);
  return missing;
}
