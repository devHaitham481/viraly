@AGENTS.md

# viraly

Reconstructs how an app grew — a chronological, evidence-backed timeline built from public sources.

**Read first:** `PRD.md` is the spec · `EPICS.md` is the delivery plan · `DECISIONS.md` holds open
questions · `shape.json` is the verified HabitKit fixture and the shape everything must produce.

Currently at **E2** done. Postgres-backed queue, global per-host rate limiter, two sources
(iTunes + Hacker News), async crawls with a polling UI. No LLM yet; Wayback is E3.

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
