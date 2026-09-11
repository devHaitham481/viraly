/**
 * Domain registration date — the earliest dated fact about a project.
 *
 * The first Wayback capture only tells you when a crawler happened to notice the site. Registration
 * is when the founder bought the name, which is usually earlier and is a real decision with a date
 * on it: habitkit.app was registered 2021-07-31, two weeks before the first capture and sixteen
 * months before the App Store launch.
 *
 * One request, no key, no auth. RDAP replaced WHOIS and returns structured JSON.
 */

import type { Event } from "../schema.ts";
import type { Ctx } from "../fetcher.ts";
import type { Source, SourceResult } from "./registry.ts";

export const rdapUrl = (domain: string) => `https://rdap.org/domain/${encodeURIComponent(domain)}`;

interface RdapResponse {
  events?: { eventAction?: string; eventDate?: string }[];
}

export function registrationDate(body: string): string | null {
  let parsed: RdapResponse;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const found = parsed.events?.find((e) => e.eventAction === "registration")?.eventDate;
  const date = found?.slice(0, 10);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export const rdap: Source = {
  id: "rdap",
  tier: 0,
  hosts: ["rdap.org"],
  needs: ["domain"],

  async collect(app, ctx: Ctx): Promise<SourceResult> {
    const domain = app.domain!;
    try {
      const date = registrationDate(await ctx.fetchText(rdapUrl(domain)));
      if (!date) {
        return {
          events: [], metrics: [],
          coverage: { status: "empty", note: `no registration date published for ${domain}` },
        };
      }

      const events: Event[] = [
        {
          date,
          // Deliberately NOT `launch`: `computeInsights` anchors on the first launch event, and
          // registering a domain is not shipping a product. Treating it as one would silently move
          // every milestone and the pre-launch figure along with it.
          kind: "product_change",
          title: `Domain ${domain} registered`,
          source: "rdap",
          by: null,
          by_founder: true,
          url: rdapUrl(domain),
          number: null,
          date_exact: true,
        },
      ];

      return { events, metrics: [], coverage: { status: "ok", note: `registered ${date}` } };
    } catch (err) {
      return {
        events: [], metrics: [],
        coverage: { status: "failed", note: err instanceof Error ? err.message : String(err) },
      };
    }
  },
};
