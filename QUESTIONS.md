# What a founder wants to know

Every question someone launching a comparable app would ask about a target, each mapped to a metric
and the source that answers it.

This doubles as the roadmap: **✅ answerable today · ⚠ partial · ❌ blocked**. A question with no
honest metric behind it does not belong here — the point is to answer with evidence, not to have an
opinion.

---

## 1. Launch

| Question | Metric | Source | |
|---|---|---|---|
| How long did they build before going public? | `pre_launch_days` | Wayback first capture → store release | ✅ |
| What was v1.0 actually? | release notes for the first version | App Store version history | ✅ |
| Did they launch free or paid? | `model` at launch | in-app purchase catalogue | ✅ |
| Did they launch on Product Hunt, and where did it place? | launch event + upvotes | Product Hunt | ❌ needs free token |
| Did they post it to HN themselves, or did someone else? | `by_founder` on the HN event | HN Algolia + resolved handles | ⚠ handles often unresolved |
| Did the launch move anything? | velocity before vs after | growth series ± 120 days | ⚠ usually unmeasurable — captures are ~2 months apart |

## 2. Traction — "am I failing, or is this normal?"

| Question | Metric | Source | |
|---|---|---|---|
| How long to 100 / 1,000 / 10,000 ratings? | `milestones` with brackets | archived store pages | ✅ |
| What did year one actually look like? | `year_one` + its measurement offset | archived store pages | ✅ |
| Is growth accelerating or flattening? | `growth_early` vs `growth_recent` | disjoint windows on the series | ✅ |
| What is the current rate? | ratings/month, last readings | growth series | ✅ |
| How do they compare to me at the same age? | `age_series`, launch-aligned | `/compare` | ✅ |
| How many downloads, really? | — | **no public source.** Review count is a proxy, not a count | ❌ by nature |

## 3. Product & shipping

| Question | Metric | Source | |
|---|---|---|---|
| How often do they ship? | `median_days_between_releases` | version history | ✅ |
| What did they ship that mattered? | release notes per feature version | App Store blob | ✅ |
| Did a specific release change growth? | verdict around that date | impact windows | ⚠ only where readings bracket it |
| Did they expand to more languages? | supported languages over time | archived store pages | ❌ unbuilt, data is present |
| Did they redesign? | screenshot set changes | archived store pages | ❌ unbuilt, data is present |

## 4. Monetization

| Question | Metric | Source | |
|---|---|---|---|
| Free, freemium, or paid up front? | `model` | IAP catalogue | ✅ |
| When did they start charging? | first paid offer date | IAP catalogue over time | ✅ |
| What do they charge, per term? | plans with billing period | IAP catalogue | ✅ |
| Did they raise prices, and when? | `Added plan` / `Price changed` events | IAP diffs | ✅ |
| Did a price rise cost them growth? | verdict around the pricing event | impact windows | ⚠ |
| Lifetime vs subscription — which did they bet on? | plan mix over time | IAP catalogue | ✅ |

## 5. Positioning

| Question | Metric | Source | |
|---|---|---|---|
| How many times did they reposition? | `repositionings` | Wayback landing-page diffs | ✅ |
| What did the message change from and to? | headline per era | Wayback diffs | ✅ |
| Did the store listing change with it? | `aso` events | App Store name/description diffs | ✅ |
| Did repositioning precede a growth change? | verdict around the event | impact windows | ⚠ |
| What keywords are they targeting? | store title / subtitle terms over time | archived store pages | ❌ unbuilt |

## 6. Distribution and word of mouth — **the weakest area**

| Question | Metric | Source | |
|---|---|---|---|
| Who talked about them, and when? | mention events by platform | HN ✅ · Reddit ❌ · X ❌ · YouTube ❌ · podcasts ❌ | ⚠ |
| Did they get press? | dated press mentions | Exa `category=news` | ❌ needs key |
| Did they run paid ads, starting when? | ad-library entries | Meta · TikTok · Google | ❌ **all three need a browser** — see below |
| What content did they publish, and how often? | `own_content` cadence | sitemap + per-post dates | ✅ |
| Did content correlate with a growth change? | verdict around post clusters | impact windows | ⚠ |
| Did a single post or video drive a spike? | mention event + velocity delta | needs mention sources first | ❌ |
| Who links to them? | backlinks with first-seen dates | Common Crawl / Exa | ❌ unbuilt |

**On the ad libraries (checked 2026-09-11):** Meta returns **403** to a plain fetch, TikTok's creative
API returns `no permission`, and Google Ads Transparency serves a 2.5 MB SPA shell whose data comes
from an undocumented `SearchService/SearchCreatives` RPC. All three are Tier 3 (browser) work, not
the free Tier 0 they appear to be from a browser window.

## 7. The niche

| Question | Metric | Source | |
|---|---|---|---|
| Which apps are comparable? | similar-site set | Exa find-similar | ❌ needs key |
| How does the cohort grow, typically? | median milestones across the set | crawl each, aggregate | ❌ needs the set first |
| Am I ahead or behind for my age? | age-aligned position in the cohort | `/compare` | ⚠ works, needs more apps crawled |
| What do the fastest growers in this niche have in common? | shared events across top performers | aggregate | ❌ the end goal |

---

## Rules this table follows

1. **A question without a metric is an opinion.** If there is no column three, the row does not belong.
2. **Most attribution is unmeasurable and must say so.** Archived captures land roughly every two
   months, so for most events there is no reading close enough on either side to compare. `unknown`
   is the common, correct answer — see `lib/impact.ts`.
3. **Correlation is not cause, and adjacent events are indistinguishable.** Two events three days
   apart share the same before/after window; the data cannot separate them.
4. **Completeness is not achievable.** An app grown by a deleted TikTok or an unarchived newsletter
   leaves nothing to find. The coverage report is the honest answer, not a claim of totality.

## What would move the most, in order

1. **Reddit** — a free OAuth app. One call returns a founder's whole posting history, and §6 is the
   weakest section in this document.
2. **Exa** — fills press, open-web mentions, and unlocks §7 entirely via find-similar.
3. **Product Hunt** — a free token closes most of §1.
4. **E7 browse runtime** — the only route to the ad libraries and X.
5. **Denser growth readings** — everything marked ⚠ is limited by ~2-month capture spacing, not by
   missing sources. Play Store install brackets would add a second, independent series.
