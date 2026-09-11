/**
 * The founder's public code — open source as a marketing surface.
 *
 * Works unauthenticated at 60 requests/hour, which is ample here: one call returns every public
 * repository with its creation date. A token raises the limit but is not required, so this stays in
 * the keyless tier.
 */

import type { Event } from "../schema.ts";
import type { Ctx } from "../fetcher.ts";
import type { Source, SourceResult } from "./registry.ts";

export const reposUrl = (handle: string) =>
  `https://api.github.com/users/${encodeURIComponent(handle)}/repos?per_page=100&sort=created`;

interface Repo {
  name?: string;
  html_url?: string;
  created_at?: string;
  stargazers_count?: number;
  fork?: boolean;
  description?: string;
}

export const github: Source = {
  id: "github",
  tier: 0,
  hosts: ["api.github.com"],
  needsHandle: "github",

  async collect(app, ctx: Ctx): Promise<SourceResult> {
    const handle = app.handles.github!;
    try {
      const repos = JSON.parse(await ctx.fetchText(reposUrl(handle))) as Repo[];
      if (!Array.isArray(repos)) {
        return { events: [], metrics: [], coverage: { status: "failed", note: "unexpected response" } };
      }

      const events: Event[] = repos
        // Forks are not authored work, and a repo with no stars is rarely a public-facing move.
        .filter((r) => !r.fork && r.created_at && r.html_url && (r.stargazers_count ?? 0) >= 1)
        .map((r) => ({
          date: r.created_at!.slice(0, 10),
          kind: "own_content" as const,
          title: `Published ${r.name} on GitHub`,
          source: "github" as const,
          by: handle,
          by_founder: true,
          url: r.html_url!,
          number: r.stargazers_count ?? null,
          date_exact: true,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        events, metrics: [],
        coverage: events.length
          ? { status: "ok", note: `${events.length} of ${repos.length} repos (non-fork, starred)` }
          : { status: "empty", note: `${repos.length} repos, none public-facing` },
      };
    } catch (err) {
      return {
        events: [], metrics: [],
        coverage: { status: "failed", note: err instanceof Error ? err.message : String(err) },
      };
    }
  },
};
