# What else can we offer? — researched 2026-09-14

Eleven sources are built. This is an assessment of what is left, based on probing the data rather
than listing ideas. Each claim below was checked against real captures.

**The headline conclusion: more sources is no longer where the value is.** The two largest remaining
gains are synthesis and cohort context, and neither needs a new scraper.

---

## A. Verified reachable — build these

### A1. Rating average over time — already collected, never shown
20 dated points already sit in `metrics` as `ios_rating_avg`:

```
2022-11  5.0    2024-02  4.9    2025-01  4.8    2026-05  4.9
```

For HabitKit it barely moves, which is itself the finding: quality held while installs went 100+ →
500,000+. For an app that degrades under scale it would be the clearest possible warning sign, and it
costs nothing — the data is in the database today, unsurfaced.

**Effort: trivial. Value: high for some targets, zero for others.**

### A2. Third-party tooling over time — works, and the null result is interesting
Detecting vendor scripts across archived captures works. For HabitKit the answer is startling:

```
2021 → 2026:  one script tag per capture, self-hosted, nothing external
```

No Google Analytics, no Plausible, no Intercom, no Stripe, no chat widget. A six-figure-ARR app whose
landing page carries **no marketing stack at all**. Only the framework is detectable (Astro from
2024-08, Alpine from 2025-08).

Honest caveat: this is thin precisely because the target is a mobile app whose site is a brochure.
For a SaaS product — Stripe, Intercom, Segment, a CDP — it would be far richer. Build it, but expect
it to be informative mainly for web products.

**Effort: small, zero new requests. Value: varies sharply by target type.**

### A3. What they tried and dropped
`structure` already holds first-seen dates for every archived path. The inverse — a path that stops
appearing — is evidence of an abandoned experiment: a pricing page that vanished, a section deleted,
a feature page removed. Nobody publishes their retreats, and this is the only way to see them.

**Effort: small, zero new requests. Value: high — genuinely unavailable elsewhere.**

### A4. Reviews-per-install ratio
Both series already exist (`ios_rating_count`, `play_installs`). Their ratio is a crude engagement
proxy, and a change in it is more interesting than either alone.

**Effort: trivial. Value: moderate, and needs care — install brackets are coarse.**

---

## B. Verified NOT reachable — stop considering these

| Idea | Finding |
|---|---|
| **App Store category rank over time** | Archived store pages carry **no** rank. No `#12 in Productivity`, no `chartPosition`, no `rank` field — "top charts" appears only as nav chrome. Ranking history needs a paid tool (Appfigures, Sensor Tower). |
| **Paid influencer detection** | Instagram, TikTok and Facebook are login-walled; X needs a session. Even with access, sponsorship disclosure is inconsistent, so paid placement cannot be reliably separated from organic enthusiasm. The honest proxies — an `/affiliates` page, a press kit — are already built in `structure`. |
| **iOS download counts** | No public source exists at any price tier we would accept. Review count is a proxy and must stay labelled as one. |
| **The three ad libraries** | Confirmed 2026-09-11: Meta 403, TikTok `no permission`, Google an SPA behind an undocumented RPC. Browse-tier work. |

---

## C. Needs something from the user

| Source | Unlocks | Cost |
|---|---|---|
| **Reddit** | The weakest section of `QUESTIONS.md`. One call returns a founder's entire posting history | free OAuth app |
| **Product Hunt** | Most of the Launch section | free token |
| **YouTube** | Review videos — the real influencer channel for apps | free key |
| **ListenNotes** | Mentions *inside* transcripts, which produce no link and are invisible to every other source | paid |
| **Exa** | Press, open-web mentions, and `find-similar` for §D2 below | paid |

---

## D. The two things worth more than any remaining source

### D1. Synthesis — there is no narrative
A crawl produces ~35 events and ~85 metric points. A founder has to read a table and infer the
lesson themselves. Nothing says:

> *Built quietly for 16 months. Launched on the App Store, then repositioned 12 days later. Flat for
> over a year — roughly 30 ratings at the one-year mark. Shipped every ~8 weeks throughout. Tried SEO
> content once in mid-2024 and stopped. Doubled prices in Aug 2024 without losing momentum. Growth
> compounded 11× with no single event explaining it.*

Every fact in that paragraph is already in the database. This is the difference between a dataset and
a product, and it is one LLM call over data we already have.

**The constraint:** it must inherit the honesty rules, not paper over them. Roughly 13 of 20 steps
have no measurable effect, and a narrative that quietly implies causation would undo the work in
`lib/impact.ts`. It should say "no single event explains this" when that is what the data shows.

### D2. Cohort context — a number without a comparison is not an answer
"457 days to 1,000 ratings" means nothing on its own. Is that fast? The `/compare` view exists but is
starved: only a handful of apps have been crawled.

The cache changed this. A re-crawl now costs ~2 requests instead of 44, so crawling 50 habit trackers
is a background job rather than an afternoon. That turns every benchmark into a percentile:

> *Time to 1,000 ratings: 34 months — slower than 70% of habit trackers we have crawled.*

Needs: Exa `find-similar` to build the cohort, or a manual seed list to start.

---

## Recommended order

1. **A1 + A4** — surface what is already collected. Hours, not days.
2. **D1 synthesis** — the largest single jump in perceived value, and all inputs exist.
3. **A3 abandoned pages** — cheap, and genuinely unavailable anywhere else.
4. **Reddit**, once the key exists — still the highest-yield unclaimed source.
5. **D2 cohort** — needs a seed list; the infrastructure is ready.
6. **A2 tooling** — build when the first SaaS target lands, where it will actually pay.
