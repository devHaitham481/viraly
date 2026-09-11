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
app/              Next.js App Router — page.tsx is the whole UI
  api/resolve/    name → candidates
  api/crawl/      chosen ios_id → CrawlResult
lib/schema.ts     THE CONTRACT — Event, Metric, Coverage, AppIdentity
lib/fetcher.ts    the Ctx seam — injectable fetch + clock; where rate limiting happens
lib/crawl.ts      createCrawl (sync resolve + queue the rest) / readCrawl (poll)
lib/db/           connection + schema.sql
lib/queue/        global per-host token bucket
lib/sources/      registry.ts declares the Source shape; one file per source
worker/           generic — reads the registry, knows nothing about any source
components/       CandidateList (disambiguation), Timeline, CoverageReport
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
- `npm run record` is incremental — it skips URLs already in the manifest. Use `--force` to redo all,
  and think twice: that is 24 archive.org fetches.
