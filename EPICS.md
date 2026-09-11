# Viraly — Epics

Planning method: the AI-native SDLC playbook (intent → spec → plan → build → test → deploy → maintain).
`PRD.md` is this project's `spec.md`. Each epic gets its own `plan.md`, written in plan mode before any code.

---

## The feedback loop — read this first

The playbook's engine is "the agent verifies its own work before a human sees it." That assumes
verification is cheap and local. **Ours is not:** correctness depends on live third-party sites that
change, rate-limit, and returned 429s during research.

**The loop is fixtures.** Freeze raw HTTP responses; assert the pipeline turns them into an exact
golden `shape.json`. Deterministic, offline, free, CI-runnable.

Seed corpus already captured during research:
`itunes.json`, `hn.json`, `hn2.json`, `cdx.json`, `wb2021.html`, `as.html`.

The playbook's "20–50 real tasks with expected outcomes" becomes **20–50 saved targets with expected
timelines**. HabitKit is eval #1.

> This is also why §13.4 rejects Stagehand: non-deterministic extraction makes a golden-output eval
> impossible, which costs us the entire verification loop.

---

## Epics

Vertical slices, not horizontal layers. Every epic ends demoable.

### E0 — Walking skeleton ✅ done 2026-09-11
Search box → resolve + disambiguate → **one** source (iTunes) → one event rendered → one coverage row.
Synchronous, no queue, no LLM.
**Gate:** type "HabitKit", pick the right one of the two App Store apps, see 1 event and a coverage row.
**Also:** write `CLAUDE.md` here — conventions invented before code are fiction.

*Shipped:* Next 16 / React 19 / Tailwind 4. `lib/schema.ts` is the contract; `lib/sources/itunes.ts` is the
pattern every later source copies. All 7 verification steps pass, including the failure path
(`coverage: failed`) and the impostor-app test.

### E1 — Fixture harness ✅ done 2026-09-11
Freeze the seed corpus. Golden `shape.json`. Offline test runner. CI.
**Gate:** the test suite reproduces the golden output with **zero network calls**.
**Why second:** build the verification loop before the velocity, so E3+ cannot silently regress E0.

*Shipped:* `lib/fetcher.ts` is the seam — sources take a `Ctx` (injectable fetch + clock) instead of
calling `fetch`, which buys offline replay, a frozen clock, and the E2 home for the rate limiter.
`node --test` runs TypeScript natively, so no test framework was added. 14 tests, 393ms, zero
network. `npm run record` refreshes fixtures; `npm run golden` regenerates expected output.
Verified the suite has teeth: a silent one-line regression fails 3 tests.

*Outstanding:* hooks (EPICS governance table) — needs `settings.json`, best done via `/update-config`.

### E2 — Queue ✅ done 2026-09-11
pg-boss, one job row per `(target, source)`, **global per-host token bucket in Postgres**.
The job table *is* the coverage block — do not build these twice.
**Gate:** two concurrent crawls of different targets do not 429 each other.

*Shipped:* Postgres 17 via docker-compose. One `source_runs` table serves as both queue and coverage
report, claimed with `FOR UPDATE SKIP LOCKED` — pg-boss and Drizzle both dropped (PRD §12.5).
Sources are declarative descriptors (`lib/sources/registry.ts`: id, tier, hosts, needs, collect) and
the worker is generic — adding a source never touches it. Hacker News added as the first queued
source, proving the machinery. Crawls are now async: identity resolves synchronously, the UI polls.

*Gate verified:* 24 concurrent resolves against a capacity-10 / 2-per-sec bucket took **9.13s** vs
~0.1s unthrottled, matching the predicted floor. 20 simultaneous `trySpend` calls granted exactly
`capacity` — the UPDATE is atomic, no double-spend.

### E3 — Wayback spine ✅ done 2026-09-11
Capture list → sampled captures → `turndown` → one batched LLM call with a schema → `product_change`
events. Handle gzip, apex-vs-www, redirects, 429 backoff.
**Gate:** reproduces the HabitKit positioning pivot (PRD §6.2) automatically, at zero cost.

*Shipped — and no LLM.* A positioning change *is* a headline change, so extraction is deterministic:
CDX index → sample ≤24 monthly captures → strip tags → diff the tagline. That keeps the output
golden-testable (a model would break the eval) and the cost at zero, exactly as the gate asks. A
model summarising *what* changed is polish, layered on later without touching this.

*Gate verified:* reproduces all four eras — Aug 2021 "simple and social" (the social web app,
15 months pre-iOS) → Dec 2022 "Consistency Tracker" → Jun 2024 "Change Your Life One Habit at a
Time" → Sep 2026 "The Habit Tracker You Can Actually See". Full crawl: 8 events from 3 sources in
49s, correctly throttled.

*The timeline now tells a story the sources cannot tell alone:* the iOS release (2022-11-26) and the
repositioning (2022-12-07) are **twelve days apart** — visible only where iTunes and Wayback interleave.

*Two real bugs found and fixed:* a naive `/<[^>]+>/` closes early on `>` inside a quoted attribute
(Alpine's `window.scrollY > 24`), spilling markup into the copy; and `liveCtx`'s 15s default silently
dropped the CDX index, which routinely takes 12s+.

### E4 — Growth curve ✅ done 2026-09-11
**First task: verify JSON-LD survives archiving** (PRD §13.1 is UNVERIFIED and this epic depends on it).
Then archived store pages → regex JSON-LD → `metrics` time series. Play install brackets.
Try the availability-API A/B for the CDX timeout (PRD §9.9).
**Gate:** ≥8 dated metric points for HabitKit; chart renders under the timeline.

*The assumption held.* PRD §13.1's UNVERIFIED claim is now verified: Apple's server-rendered JSON-LD
`aggregateRating` survives into Wayback captures. 19 reviews in Feb 2023, 288 in Jul 2024, 1,864 in
Mar 2026. So the growth curve is a regex and a `JSON.parse` — **no browser, no DOM parser, no paid
ranking API**.

*And the CDX timeout was never a timeout.* The same query that "timed out at 40s" during research
returns in **4.8s** now. It was archive.org throttling us, exactly as §9.9 suspected — the limiter
built at E2 fixed a problem we had misdiagnosed as query cost.

*Gate verified:* **21 dated points**, 1 review (launch week, 2022-11-29) → 2,410 today. Annotated
SVG chart with event ticks, dashed where a date is approximate. Full four-source crawl: 8 events +
21 metrics in ~124s, all sources `ok`.

*Two bugs found:* `trackViewUrl` carries `?uo=4`, which matches no archived capture (silent zero
results); and the Next dev server was serving pre-`store_url` code, which is why the first run
skipped the source.

### ▶ v1 = E0–E4 ✅ COMPLETE 2026-09-11

*Deepened after first real use:* archived store pages were being downloaded whole (250–800KB) and
mined for a single integer. They also carry `versionHistory` with Apple's own exact release dates,
plus `name`, `description` and `offers.price`. Extracting those took **8 events → 25** with zero
extra requests, and closed PRD §7's "App Store version history — no known free endpoint".
One command, one target: real timeline + real growth curve + honest coverage report.
Cost: zero. No API keys, no paid tier, no browser.
**Exit review:** run against a second, non-HabitKit target before declaring v1.

### E6 — Review pass ✅ done 2026-09-11

First independent review of the codebase, by the read-only `reviewer` agent defined at E0 and never
run until now. Author and reviewer had been the same party for ~2,000 lines.

**Two blockers, both confirmed empirically:**
- `schema.sql` put `ALTER TABLE source_runs` *above* `CREATE TABLE source_runs`. `ADD COLUMN IF NOT
  EXISTS` guards the column, not the table, and `applySchema` sends the file as one implicit
  transaction — so a fresh database ended with **1 table out of 6** and the worker exited on startup.
  It only ever worked here because this database predates the file.
- `/api/resolve` built a `liveCtx` with no `acquire`, leaving the one endpoint a user can hammer from
  a form entirely unthrottled.

**Five correctness findings fixed**, all the same family — confident output where the honest answer
is "we don't know":
- Milestones asserted across unobserved gaps (the far edge of a 282-day hole reported as a
  measurement). Now bracketed, with an exact figure only when the bracket is ≤45 days.
- The year-one reading carried no staleness, so a 190-day-old number was labelled "after year 1".
- `pre_launch_days` took the earliest event of *any* source — a founder's 2016 GitHub repo would have
  rendered as "public 79 months before launch".
- The "nearly flat" narrative asserted flatness from the growth multiple alone; it would have said it
  of an app with 50,000 ratings in year one.
- A transient iTunes failure **overwrote the stored identity for every past crawl** of that app.

**New `blocked` coverage status** — "we had nothing to look *with*" — because `empty` already means
"we looked and there is genuinely nothing", and collapsing the two reported "this founder has no
GitHub" when the truth was a thirty-second outage.

*The lesson worth keeping:* none of these were caught by 105 passing tests, and two were **encoded**
by them. Tests pin behaviour; they do not tell you the behaviour is right.

### E5.6 — Monetization ✅ done 2026-09-11

*Where pricing actually lives for a mobile app.* Not a pricing page — most apps have none — but the
**in-app purchase catalogue**, embedded in every archived App Store capture we already download.
Tiers, prices, billing periods, subscription family names, scoped by `appAdamId`. Zero new requests.

Extracts: the monetization `model` (free · freemium · paid · paid_plus_iap), every plan with its
term, dated price metrics per billing period, and events for plans added, repriced, retired, or the
model changing.

*HabitKit's real history:* freemium from Feb 2024 at $0.99/mo · $5.99/yr · $14.99 lifetime, then in
Aug 2024 a second SKU family at roughly double — $1.99/mo · $11.99/yr · $29.99 lifetime — with the
originals left live.

*Three bugs worth recording:*
- The ISO billing period was read from a fixed window that overlaps the next offer, so one SKU read
  as `lifetime` in one capture and `month` in another. The SKU suffix (`_lt`, `_1y`) travels with the
  offer and now wins.
- Captures where Apple drops the embedded blob produced **zero** offers. Comparing against those
  would have emitted a fake "retired every plan" followed by a fake relaunch; they are now skipped
  as unparseable.
- Prices round-tripped through Postgres text and an integers-only numeric test left `"1.99"` and
  `"4.85"` as strings, so every numeric consumer silently dropped them.

### E5.5 — Insights & comparison ✅ done 2026-09-11

Built after the first real question from a user: *what data actually interests someone launching an
app?* The answer was not another source — it was arithmetic on rows already collected.

`lib/insights.ts` derives benchmarks; `/compare` overlays apps **aligned at their own launch**, which
is the only framing that answers "am I ahead or behind?". Log scale, because the first year is where
the reader lives and a linear axis flattens it into the baseline.

*The shape that justifies the feature:* HabitKit grew slowly for well over a year, shipped about
every 57 days, wrote its first blog post on day 605, then compounded 11×. No event in the timeline
explains it — the honest shape of most growth (PRD §9.5), and one no teardown publishes.

> **Corrected 2026-09-11.** This section first claimed "**33 ratings at the end of year one**". That
> was wrong: the reading was taken on day 175, *190 days before* the anniversary, and the archive has
> a 282-day hole spanning the one-year mark. HabitKit's year-one figure is **unknown**; the nearest
> reading is 184 on day 457. The qualitative story holds, the number did not. A test named
> "year one is the number that matters" had pinned it — see the review findings below.

*Two correctness bugs caught by real data:*
- Early/late growth windows **overlapped** on short series, reporting 1.0× acceleration regardless of
  what the app did. Now disjoint, and null when the series is too short to support the comparison.
- Milestones were asserted beyond what is observable: Hinge came back as "3,896 days to 100 ratings"
  because the archive holds no App Store captures from 2013 and our first reading is already at
  759,323. Now reported as `already_passed` with an honest upper bound where one is useful, and
  "before our data" where it is not.

### E5 — Axis B (founder identity) ◐ partial 2026-09-11
Reddit OAuth, YouTube, Product Hunt, GitHub keys. Enumerate the founder's accounts → `by_founder: true`.
**Gate:** HabitKit founder's playbook, in order. **Met — 29 events, 28 of them founder-side.**

*Shipped keyless.* `lib/handles.ts` discovers accounts from the site footer during identity
resolution (not as a queued source — everything on Axis B depends on it and the worker has no
dependency ordering). Two new sources: `blog` (sitemap → per-post `datePublished` → `own_content`)
and `github` (unauthenticated API, 60/hr).

*Precision over recall in handle resolution.* A landing page links to far more than its own accounts;
taking the most-linked GitHub URL on overcast.fm yields `yui`, a JS library, which would attribute a
stranger's whole history to the founder. Candidates must now resemble the brand or the developer
name. Cost: overcast.fm resolves nothing rather than something wrong. That is the right trade — a
missing handle costs coverage, a wrong one silently corrupts the timeline.

*Still blocked, needs credentials from the user:*
- **Reddit** — `/user/*/submitted.json` returns **403** unauthenticated. Needs a free OAuth app. This
  is the single highest-yield unclaimed source: one call returns a founder's entire posting history.
- **YouTube** — the RSS feed works keyless (200), but resolving a channel id needs the Data API key.
- **Product Hunt** — needs a free token.

### E6 — Axis A (open-web mentions)
ListenNotes, Brave/SerpAPI, backlinks. Domain-anchored only. LLM relevance filter via Batch API.
**Gate:** mention events survive a precision spot-check.

### E7 — Browse tier
Vendor `agent-computer/`. One-time manual X login through the live viewer. Ad libraries.
X is `coverage: partial` **by design**.
**Gate:** X adds events without becoming a dependency — v1 must still pass with X disabled.

### E8 — Freeze & incremental ✅ done 2026-09-11
Crawl-once storage, frozen history, moving-window re-crawl.
**Gate:** a second run on the same target is near-free. **Met: 124s → 2.6s, ~48×.**

*Shipped:* `lib/cache.ts` — a persistent HTTP cache in Postgres, wrapping the `Ctx` seam rather than
replacing it, so the offline suite never sees it and the rate limiter still sits underneath.

The TTL is decided by whether a URL *can* change, which is the founding observation of the whole
project applied literally:
- a dated Wayback capture → **immutable, cached forever**
- a CDX index → new captures appear slowly, 7 days
- iTunes lookups, HN, GitHub → hours to a day

Cache sits **in front of** the limiter: a hit must not spend a token, or a fully cached re-crawl
would still wait out two minutes of throttling for requests it never makes.

*Verified:* three consecutive HabitKit crawls produced **identical output — 33 events, 68 metrics,
0 violations** — cold and warm. wayback 25/25 cached, blog 5/5, hackernews 1/1. Cache holds 84 URLs
/ 14 MB after two apps; Postgres TOASTs the body column so it compresses on disk for free.

*Why it matters beyond speed:* archive.org throttled us twice in one day. A re-crawl now costs
roughly two requests instead of forty-four, which is what makes crawling enough apps for `/compare`
practical at all.

---

## Governance artifacts

| Artifact | Contents | When |
|---|---|---|
| `CLAUDE.md` | Commands, layout, conventions, known traps (gzip, apex-vs-www, 429s) | E0 |
| `.claude/skills/new-source/` | The recipe for a source module: signature, required fixture, coverage row, test. ~15 sources will use it. | E1 |
| `.claude/skills/scraper-etiquette/` | Never bypass the global limiter. Always write a coverage row. Never invent a value. | E2 |
| `REVIEW.md` | Rule #1: **no invented data** — every event needs a real fetched URL. Rule #2: no network in tests. Rule #3: every source writes coverage, success or failure. | E1 |
| Hooks | Block edits to vendored `agent-computer/`. Run the fixture eval on any `packages/sources/` change. | E1 |

> Rule #1 exists because fabricated app ids appeared in the first draft fixture and both were wrong.
> That is this project's characteristic failure mode, so it belongs in policy rather than in memory.

---

## Stage 6 — monitoring

The signal is **per-source yield**. A scraper that silently returns zero rows is the characteristic
failure of this kind of system: the site changed and nothing threw.

Bands, per source, against historical average:
- 1σ — log
- 2σ — diagnose
- 3σ (e.g. 0 events across 3 consecutive targets) — agent writes `intent.md`, enters triage

The `coverage` block built for user-facing credibility is the same object as the monitoring signal.

---

## Measurement

**Leading:** first-pass eval success rate · time to add a new source · coverage completeness per run.
**Lagging:** sources silently broken in production · reruns needed per target · golden-output drift.
