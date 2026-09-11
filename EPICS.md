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

### E3 — Wayback spine
Capture list → sampled captures → `turndown` → one batched LLM call with a schema → `product_change`
events. Handle gzip, apex-vs-www, redirects, 429 backoff.
**Gate:** reproduces the HabitKit positioning pivot (PRD §6.2) automatically, at zero cost.

### E4 — Growth curve
**First task: verify JSON-LD survives archiving** (PRD §13.1 is UNVERIFIED and this epic depends on it).
Then archived store pages → regex JSON-LD → `metrics` time series. Play install brackets.
Try the availability-API A/B for the CDX timeout (PRD §9.9).
**Gate:** ≥8 dated metric points for HabitKit; chart renders under the timeline.

### ▶ v1 = E0–E4
One command, one target: real timeline + real growth curve + honest coverage report.
Cost: zero. No API keys, no paid tier, no browser.
**Exit review:** run against a second, non-HabitKit target before declaring v1.

### E5 — Axis B (founder identity)
Reddit OAuth, YouTube, Product Hunt, GitHub keys. Enumerate the founder's accounts → `by_founder: true`.
**Gate:** HabitKit founder's playbook, in order.

### E6 — Axis A (open-web mentions)
ListenNotes, Brave/SerpAPI, backlinks. Domain-anchored only. LLM relevance filter via Batch API.
**Gate:** mention events survive a precision spot-check.

### E7 — Browse tier
Vendor `agent-computer/`. One-time manual X login through the live viewer. Ad libraries.
X is `coverage: partial` **by design**.
**Gate:** X adds events without becoming a dependency — v1 must still pass with X disabled.

### E8 — Freeze & incremental
Crawl-once storage, frozen history, moving-window re-crawl.
**Gate:** a second run on the same target is near-free.

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
