/**
 * Podcast appearances — founder interviews, via Apple's free episode index.
 *
 * This is the cheapest fix for the weakest section of `QUESTIONS.md`: word of mouth. It is also the
 * only source where the *reasoning* shows up. Everything else records that a founder repositioned or
 * raised prices; an interview is where they say why, and what they think actually worked.
 *
 * The signal is often in the episode title alone — HabitKit's German appearance is literally titled
 * "Von 5.000 auf 30.000 Dollar MRR", a revenue milestone stated in public with a date on it.
 *
 * Free, no key, same endpoint family as the identity resolver.
 */

import type { Event } from "../schema.ts";
import type { Ctx } from "../fetcher.ts";
import type { Source, SourceResult } from "./registry.ts";

export const episodeSearchUrl = (term: string) =>
  `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
  `&entity=podcastEpisode&limit=50&country=us`;

interface Episode {
  trackName?: string;
  collectionName?: string;
  releaseDate?: string;
  trackViewUrl?: string;
  description?: string;
  shortDescription?: string;
}

/**
 * Does this episode actually concern the product?
 *
 * A search hit is not a mention. Searching the *founder's* name for HabitKit returns Wisconsin
 * Badgers basketball commentary, so the brand has to appear in the episode's own text before the
 * episode becomes an event. Matched on a word boundary: "bear" must not match "bearing".
 */
export function mentionsBrand(ep: Episode, brand: string): boolean {
  const needle = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (needle.length < 3) return false;

  const haystack = [ep.trackName, ep.collectionName, ep.shortDescription ?? ep.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return new RegExp(`\\b${needle}\\b`, "i").test(haystack.replace(/[^a-z0-9\s]/g, " "));
}

/** Brands too short or too common to search for without drowning in unrelated shows. */
export const isSearchable = (brand: string) => brand.replace(/[^a-z0-9]/gi, "").length >= 4;

export const podcast: Source = {
  id: "podcast",
  tier: 0,
  hosts: ["itunes.apple.com"],
  needs: ["domain"],

  async collect(app, ctx: Ctx): Promise<SourceResult> {
    // The domain's first label is the brand — more stable than the App Store title, which carries
    // keyword stuffing ("Habit Tracker - HabitKit").
    const brand = app.domain!.split(".")[0];

    if (!isSearchable(brand)) {
      return {
        events: [], metrics: [],
        coverage: {
          status: "blocked",
          note: `"${brand}" is too short to search podcasts for without swamping the result in unrelated shows`,
        },
      };
    }

    try {
      const { results } = JSON.parse(await ctx.fetchText(episodeSearchUrl(brand))) as {
        results: Episode[];
      };

      const relevant = results.filter((e) => e.releaseDate && e.trackViewUrl && mentionsBrand(e, brand));

      const events: Event[] = relevant.map((e) => ({
        date: e.releaseDate!.slice(0, 10),
        // An appearance is coverage the product earned, not something it published.
        kind: "earned_media" as const,
        title: e.collectionName
          ? `${e.collectionName}: ${e.trackName ?? "episode"}`
          : (e.trackName ?? "Podcast episode"),
        source: "podcast" as const,
        by: e.collectionName ?? null,
        // The show is a third party, even when the founder is the guest.
        by_founder: false,
        url: e.trackViewUrl!,
        number: null,
        date_exact: true,
      }));

      events.sort((a, b) => a.date.localeCompare(b.date));

      const dropped = results.length - relevant.length;
      const note =
        `${results.length} search hits, ${events.length} mention "${brand}"` +
        (dropped ? `, ${dropped} unrelated` : "");

      return {
        events, metrics: [],
        coverage: events.length ? { status: "ok", note } : { status: "empty", note },
      };
    } catch (err) {
      return {
        events: [], metrics: [],
        coverage: { status: "failed", note: err instanceof Error ? err.message : String(err) },
      };
    }
  },
};
