---
name: new-source
description: Add a data source module to viraly. Use when adding any new scraper or API integration to lib/sources/.
---

# Adding a source

Every source is the same shape. `lib/sources/itunes.ts` is the reference implementation — read it
before writing a new one.

## The contract

```ts
export async function collect(app: AppIdentity, ctx: Ctx): Promise<{
  events: Event[];
  metrics: Metric[];
  coverage: Coverage;
}>
```

`itunes.ts` is the one exception: it runs *before* an identity exists, because it is what produces
one.

## Rules

1. **Fetch through `ctx.fetchText`, never global `fetch`.** That is the seam for offline replay and,
   from E2, the per-host rate limiter.
2. **Dates come from `ctx.now()`**, never `new Date()`. A wall-clock read makes golden output drift
   daily and the suite worthless.
3. **Never throw.** Catch, and return `coverage: { status: "failed", note: <reason> }`. A source that
   throws takes the whole crawl down; a source that reports failure loses one row.
4. **Four coverage states, used precisely:** `ok` · `partial` (got some, known gap) · `empty` (looked,
   genuinely nothing) · `failed` (could not look).
5. **Every event needs a real fetched URL.** No placeholders. Unknown fields are `null`.
6. **Search the domain, not the name** wherever the source allows it. HN name search for "habitkit"
   returns 12,135 hits; domain search returns 1.
7. **Try embedded JSON before the DOM** — JSON-LD, `__NEXT_DATA__`, inline state. More stable,
   more complete, cheaper (PRD §13.1).

## Steps

1. Write `lib/sources/<name>.ts` exporting URL builders (so fixtures and tests can name them) and
   `collect`.
2. Add `<name>` to `SourceId` in `lib/schema.ts`.
3. Add the URLs to `TARGETS` in `scripts/record.ts`, then `npm run record`.
4. Write `tests/<name>.test.ts`. Cover, at minimum: the happy path, the `empty` case, and the
   `failed` case.
5. `npm run golden` **only if** this source changes existing golden output on purpose.
6. `npm test && npm run typecheck`.

## Known traps

- Fetch both apex and `www`, and follow redirects — `www.habitkit.app/sitemap.xml` 301s to nothing.
- Wayback bodies are often gzipped without a matching header; sniff for `\x1f\x8b`.
- archive.org throttles by IP, hard. Pace requests; re-record sparingly.
- Rating counts and other live counters drift between calls — that is why fixtures are frozen.
