@AGENTS.md

# viraly

Reconstructs how an app grew — a chronological, evidence-backed timeline built from public sources.

**Read first:** `PRD.md` is the spec · `EPICS.md` is the delivery plan · `DECISIONS.md` holds open
questions · `shape.json` is the verified HabitKit fixture and the shape everything must produce.

**v1 (E0–E4) complete; E5 partial.** Six sources
(iTunes · Wayback · App Store · blog · GitHub · Hacker News) and handle discovery.
Reddit/YouTube/Product Hunt await API credentials.

**v1 (E0–E4) is complete.** Postgres-backed queue, global per-host rate limiter, four sources
(iTunes · Wayback · App Store · Hacker News), async crawls with a polling UI, annotated growth
chart. **Still no LLM anywhere** — every source is deterministic, which is what keeps the golden
eval suite meaningful. Next: E5 (founder identity / Axis B).

## Commands

```bash
docker-compose up -d   # Postgres 17 on :5433  (this box has compose v1 — `docker compose` is absent)
npm run dev            # next dev
npm run worker         # the queue worker; run as many as you like
npm test               # offline eval suite — zero network, zero infra
npm run test:db        # limiter tests; needs Postgres
npm run record         # refresh fixtures from live APIs (deliberate, rate-limited)
npm run golden         # regenerate expected output — only when that IS the intent
npm run typecheck && npm run build
```

## Layout

```
app/              Next.js App Router
  page.tsx        the landing page — a SERVER component, prerendered with a real crawl baked in
  api/resolve/    name → candidates
  api/crawl/      chosen ios_id → CrawlResult
lib/schema.ts     THE CONTRACT — Event, Metric, Coverage, AppIdentity
lib/fetcher.ts    the Ctx seam — injectable fetch + clock; where rate limiting happens
lib/crawl.ts      createCrawl (sync resolve + queue the rest) / readCrawl (poll)
lib/db/           connection + schema.sql
lib/queue/        global per-host token bucket
lib/sources/      registry.ts declares the Source shape; one file per source
worker/           generic — reads the registry, knows nothing about any source
lib/demo.ts       the landing page's worked example, from fixtures/golden/demo-habitkit.json
components/       CandidateList (disambiguation), Timeline, CoverageReport
  Crawler.tsx     the only client component — search, poll, render a live result
```

`lib/` mirrors the package boundaries in PRD §12.2. At E2 it becomes `packages/` — a directory move,
not a rewrite.

## Rules

1. **Never invent a value.** Every event needs a real, fetched URL. No placeholder ids, no guessed
   dates. If a field is unknown it is `null` and coverage says why. (Two fabricated app ids appeared
   in the first draft of this project; both were wrong.)
2. **Every source writes a coverage row — on success *and* failure.** A source that fails silently is
   the characteristic break of this system. A gap in the timeline must never be indistinguishable
   from a gap in the crawl.
3. **Never edit `agent-computer/`** once vendored (E7). Upstream MIT code.
4. **Never edit a test to make it pass.** If a test is wrong, that is a finding.
5. Don't add `confidence`, `eras`, `edges` or `findings` to the schema. Deferred on purpose (PRD §4).

## Known traps

- **Fetch both hosts and follow redirects.** `www.habitkit.app/sitemap.xml` 301s and returns nothing;
  the apex host works.
- **Wayback captures are often gzipped** even without a matching header — sniff for `\x1f\x8b`.
- **archive.org throttles by IP, hard** (PRD §9.9). Previously-working queries start returning 429.
  Pace requests; a global per-host token bucket lands at E2.
- **Search the domain, never the bare name.** HN name search for "habitkit" returns 12,135 hits;
  domain search returns 1.
- **The store id is the only safe key.** Two unrelated apps are called HabitKit.
- **Rating counts are live** and drift between calls — freeze fixtures, never assert against the network.
- Apple serves the iTunes endpoints as `text/javascript`; parse the text, don't rely on `res.json()`.
- **CDX routinely takes 12s+.** The 15s default timeout silently drops it; `workerCtx` uses 45s.
- **Never strip tags with `/<[^>]+>/`.** Attributes contain `>` inside quotes (Alpine, htmx) and the
  regex closes the tag early, spilling markup into extracted copy. Use `stripTags` in `wayback.ts`.
- **Strip query params off `trackViewUrl`.** Apple appends `?uo=4`; archived captures are keyed by
  the clean URL, so keeping it finds zero Wayback snapshots — silently.
- **Restart `next dev` after changing `lib/`** if a route seems to ignore the change. Stale compiled
  route code caused a source to be skipped for a field that the resolver was returning correctly.
- **Archive captures embed OTHER apps' data.** A store page carries a `versionHistory` for every app
  it links to (~16 per capture). Always scope extraction to the subject's id, or you build a
  confident, fictional timeline out of unrelated apps' releases.
- **Fetch with `id_`, link without it.** `id_` gives raw bytes for parsing; the plain replay URL is
  what renders for a human. Linking `id_` shows an unstyled broken page.
- **archive.org is slow AND variable** — the same trivial CDX query took 5s, then 17s, then timed out
  entirely within one session. It gets a 90s budget in `HOST_TIMEOUT_MS`; everything else gets 15s.
- **Crawls are cached in Postgres** (`http_cache`). A re-crawl is ~2s instead of ~2min. Dated Wayback
  captures are cached forever because they are immutable; indexes and live lookups have short TTLs.
  To force a refetch, delete the rows: `delete from http_cache where url like '%...%'`.
- **The landing page ships a recorded crawl**, not a live one — `lib/demo.ts` statically imports
  `fixtures/golden/demo-habitkit.json` so `/` prerenders with no database, worker or network. Add a
  source and the page keeps describing the old product until you run `npm run golden`;
  `tests/demo.test.ts` fails when a registered source is missing from it.
- **`lib/` is imported by the test runner as well as the bundler**, so the `@/` alias does not work
  there — node resolves it as a package and fails. Relative imports only, and a JSON import needs
  `with { type: "json" }`.
- **The timeline's sticky year headers read `--surface`**, which defaults to paper and is overridden
  to white inside the landing page's example panel. Hardcoding the colour puts a grey band across
  one of the two places it renders.
- **Play's headline count is abbreviated plain text** — `8.61K reviews`, not a quoted integer. A
  pattern requiring `"8610"` matches nothing Play has ever served, and `play_rating_count` was
  silently empty on every crawl until 2026-09-24. Parse `K`/`M` (`parseCount`).
- **An install bracket is an interval.** `500,000+` means under 1,000,000, so any ratio taken
  against its floor is overstated by up to 5×. Use `bracketCeiling` and report a range.
- **Never `toLocaleString()` without a locale.** This box is de-DE, so 2,385 rendered as "2.385" —
  wrong for English copy, and in Next.js the server and the hydrating browser can disagree. Always
  `toLocaleString("en-US")`, matching the existing `toLocaleDateString("en-US")`.
- **`ctx.progress?.(…)` does not evaluate its argument** when nobody is listening. A counter
  incremented inside the call stays at zero offline — the coverage note read "1/0 pages".
- **Absence is only evidence when the server says so.** A 404 is a fact; a timeout, a 5xx, a DNS
  failure and a missing fixture are all "we could not look" wearing the same `catch`. Use
  `httpStatus(err)` and act only on 4xx, or a bad minute becomes a confident claim that a page was
  deleted. The same guard is why `structure` checks the site root first: without it an unreachable
  domain reports that the team deleted their entire website.
- **A recorded 404 is a fixture too.** `manifest.json` entries carry `file: null` + `status`, and
  `replayCtx` replays the refusal, so "this page is gone" is testable offline.
- `npm run record` is incremental — it skips URLs already in the manifest. Use `--force` to redo all,
  and think twice: that is 24 archive.org fetches. Enumeration is cache-first: the six indexes it
  reads to decide what to sample come off disk when already recorded, so adding one fixture no
  longer depends on archive.org answering six times without a 504.
