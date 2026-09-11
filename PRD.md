# Viraly — Growth Timeline Reconstruction

**Status:** draft · **Date:** 2026-09-10 · **Validated against:** HabitKit (`habitkit.app`)

---

## 1. Summary

Given an app, company, or domain, Viraly reconstructs a **chronological, evidence-backed timeline of how it grew** — every public marketing action the founders took, every place other people wrote or talked about it, and whatever public numbers can be recovered to show the effect.

The public internet already holds the complete record of how most products grew. It is scattered across a dozen platforms and nobody has stitched it into one narrative. Viraly does the stitching.

Every row in the output carries a date, a source, and a link. Nothing is asserted without a URL a reader can open.

**This is not analytics.** No traffic estimates, no modelled revenue, no proprietary panel data. It is archaeology on public artifacts.

---

## 2. Problem

Someone researching how a product grew today has to manually check Wayback, Product Hunt, Hacker News, Reddit, the App Store, the company blog, podcast archives, and X — then reconcile a dozen tabs into a mental chronology. It takes hours per target and the result is unshareable and unverifiable.

Worse, the two most interesting things are the hardest to see manually:

1. **What the founders actually did, in order** — which channel first, what they published and when, where they posted, who they talked to.
2. **What changed as a result** — visible only if you can recover a dated growth proxy and put the events beside it.

Three findings from our HabitKit test run show the manual approach also *misses* things. See §6.

---

## 3. Users & use cases

| User | Use case | What they need from the output |
|---|---|---|
| **Indie hacker / solo founder** | "How did this competitor in my category actually grow?" | The playbook in order — which channel, when, what it looked like |
| **Competitive researcher / PMM** | "Trace this company's go-to-market history" | Dated, citable events they can paste into a doc |
| **Growth writer / teardown author** | Publish a researched teardown | Evidence links for every claim |
| **Founder auditing their own product** | "What's our public footprint, and where are the gaps?" | Coverage view — what exists and what doesn't |

The common thread: **anyone willing to understand how a thing grew and what steps the founders took to get there.** All four want the same artifact; they differ only in what they do with it.

---

## 4. Scope

### In scope for v1

**Targets: mobile apps with an App Store or Play listing only** (decided, §11.1).

- Single-target reconstruction: one app/domain in, one timeline out
- Founder marketing actions (**Axis B**) and third-party mentions (**Axis A**) — both, clearly distinguished
- Growth metrics where publicly recoverable (mobile app store data)
- A coverage report stating which sources were queried and which failed
- JSON output matching `shape.json`

### Explicitly out of scope for v1

These were considered and cut. Every one is derivable later from the same two tables, and none of them changes what we scrape — which is the only question that matters right now.

| Deferred | Why |
|---|---|
| **Eras / chapters** | Presentation concern. Derive from the metrics curve later. |
| **Causal edges** between events (direct/indirect chains) | Genuinely valuable — the "PH launch → podcast invite → Reddit thread" chain — but it is analysis on top of a complete event list. Needs the list first. |
| **Confidence scores** per event | `date_exact` covers the one case that actually affects rendering. |
| **Attribution findings** ("event X preceded a 4× jump") | Requires a dense metrics series we do not yet reliably have. |
| **Founder-claim vs. data contradiction** ("they credit X, data suggests Y") | The most interesting possible output, and the easiest to get wrong. Post-v1, and only with good metrics. |
| **Multi-target comparison / batch corpus** | Scale problem, not a modelling problem. |
| **Non-app targets as a first-class mode** | See open question §10.1. |

---

## 5. Data model

Two flat tables plus two metadata blocks. Canonical example: `shape.json`.

### `app` — the resolved identity

```
name              "HabitKit"
domain            "habitkit.app"
ios_id            "6443918070"
play_id           "com.roehl.habitkit"
founder           "Sebastian Roehl"
founder_source    "itunes lookup sellerName"
handles           { x, reddit, indiehackers, youtube, github }
```

Everything downstream keys off this block. It is the single highest-risk step in the system — see §9.1.

### `events` — one row per thing that happened

| Field | Type | Notes |
|---|---|---|
| `date` | ISO date | sort key |
| `kind` | enum | see below |
| `title` | string | human-readable, one line |
| `source` | enum | `wayback` \| `appstore` \| `playstore` \| `producthunt` \| `hackernews` \| `reddit` \| `podcast` \| `youtube` \| `blog` \| `x` \| `indiehackers` \| `ads` |
| `by` | string \| null | who did it |
| `by_founder` | bool | **founder action vs. third-party mention** — the axis that makes the output legible |
| `url` | string | evidence. Never null. |
| `number` | number \| null | whatever that source counts: upvotes, points, score |
| `date_exact` | bool | `false` = Wayback bracket, we only know the range |

`kind` values:

| kind | Meaning |
|---|---|
| `launch` | PH, Show HN, app store release |
| `own_content` | their blog post, their video, their newsletter |
| `community_post` | founder posting in Reddit / IH / forums |
| `earned_media` | podcast guest, press article, someone else's review |
| `mention` | anyone else writing or talking about it, unprompted |
| `paid_ads` | ad library entries |
| `aso` | app store title / keyword changes |
| `product_change` | pricing, positioning, feature — from Wayback diffs |

`events` sorted by `date` **is the timeline.** Filter `by_founder: true` for the playbook; `false` for where the world noticed.

### `metrics` — one row per dated public number

```
date      "2026-09-10"
metric    "ios_rating_count"
value     2410
url       "https://itunes.apple.com/lookup?id=6443918070"
```

Metrics sorted by date is the growth curve the events get plotted against. Known metric keys: `ios_rating_count`, `ios_rating_avg`, `ios_version`, `play_installs` (bracket string), `web_selfclaim` (e.g. "used by 5,000 people").

### `coverage` — what was actually looked at

Per source: `ok` with a summary, or `FAILED` with the reason. **This block is load-bearing, not bookkeeping.** A chronological timeline makes absence look like fact: an empty stretch reads as "they went quiet" when it may mean "the crawler was rate-limited." Coverage is what lets the output distinguish the two, and it is most of the credibility.

### Deliberately absent

`date` is a plain ISO string, not a precision object. `date_exact: false` is the entire concession to Wayback's inability to name a day. If a renderer needs to draw an uncertainty bar it has enough.

---

## 6. What the HabitKit test run proved

Run on 2026-09-10 against live sources, **zero API keys, zero cost.** Six sources answered.

### 6.1 One free call resolves the whole identity block

`GET https://itunes.apple.com/search?term=habitkit&entity=software&limit=3` returned:

| Field | Value |
|---|---|
| `trackId` | `6443918070` |
| `bundleId` | `com.roehl.habitkit` ← doubles as the Play id |
| `sellerName` | **Sebastian Roehl** ← the founder, free |
| `releaseDate` | **2022-11-26** |
| `currentVersionReleaseDate` | 2026-09-07 (v1.17.2) |
| `userRatingCount` / `averageUserRating` | 2410 / 4.85 |

This is the highest-value endpoint in the catalogue. It resolves the `handles` bottleneck — identity resolution was the risk flagged as most likely to fail silently, and for mobile apps one unauthenticated GET largely answers it.

### 6.2 The Wayback landing-page diff found a pivot no manual pass had

Sampling 6 of 37 monthly captures and extracting the headline copy:

| Capture | Positioning |
|---|---|
| **2021-08** | "Habit Tracking **simple and social** — Build up new habits. **Share your progress**" — *with a Sign In* |
| **2022-11 → 2024-03** | "**Consistency Tracker** — The coolest way to track your habits and streaks — **tile-based**" |
| **2025-03** | "Change Your Life One Habit at a Time" |
| **2026-09** | "The Habit Tracker You Can Actually See" |

Two things fell out that no source states directly:

- The Aug 2021 page was **a working social habit-sharing web app**, not a parking page — 15 months before the iOS release.
- There is a **pivot**: social web app → 15-month gap in captures → iOS app on 2022-11-26 relaunched as a private tile-grid tracker with the social framing dropped. The Product Hunt launch is 10 weeks *after* that relaunch, not the start of the story.

Diffing archived landing pages turns a static page into a positioning time series. It is the most novel signal in the system and it is free.

### 6.3 Domain-anchored search is mandatory, not preferred

| Query | Hits |
|---|---|
| HN Algolia `query=habitkit` | **12,135** — "habitat", "habitition", an unrelated user named `habitit` |
| HN Algolia `query=habitkit.app&restrictSearchableAttributes=url,title` | **1** — the correct post |

Four orders of magnitude of noise removed. Generalised: **search the domain, never the bare name.** The pathological case is a product called "ngl" — `ngl` means "not gonna lie", so name search returns millions of unrelated results and the pipeline drowns. `ngl.link` is unambiguous and is what people paste anyway.

### 6.4 Three failures, each of which is a requirement

| Failed | Cause | Requirement |
|---|---|---|
| `reddit.com/search.json` | blocks unauthenticated requests | Reddit OAuth is mandatory, not optional |
| `www.habitkit.app/sitemap.xml` | 301 to apex; naive fetch didn't follow | **Always try both hosts and follow redirects.** Apex worked and exposes `/blog`. |
| Wayback CDX for `apps.apple.com/...` | timed out at 40s | Needs a longer budget / async job. **This blocks the growth curve** — archived store rating counts are what make `metrics` a time series rather than one snapshot. |

The App Store CDX timeout is the most important open technical item in the whole document.

---

## 7. Source catalogue

Two orthogonal ideas organise this. **Tier** = how expensive and fragile the access is. **Axis** = which of the two questions it answers.

- **Axis B — founder identity.** Resolve one handle, then enumerate that account's history. Few calls, enormous yield, everything returned is a candidate founder action. *This is the higher-value axis and the one to build first.*
- **Axis A — domain sweep.** Search the web for the domain. Many calls, noisy, needs filtering. Finds third-party mentions.
- **Spine** — neither; direct artifacts about the product itself.

### Tier 0 — free, no authentication

| Source | Axis | Endpoint pattern | Yields |
|---|---|---|---|
| **iTunes lookup** | Spine | `itunes.apple.com/lookup?id=<trackId>` · `itunes.apple.com/search?term=<name>&entity=software` | app id, bundle id, seller/founder, release date, version + date, rating count/avg |
| **iTunes podcast search** | A | same host, `entity=podcast` | podcast episodes free, before paying for ListenNotes |
| **Wayback CDX** | Spine | `web.archive.org/cdx/search/cdx?url=<domain>&output=json&filter=statuscode:200&collapse=timestamp:6&fl=timestamp,original` | full capture list, monthly-collapsed |
| **Wayback capture** | Spine | `web.archive.org/web/<ts>id_/<url>` | raw page. **May be gzipped — check `\x1f\x8b` magic bytes.** Diff for `product_change` |
| **HN Algolia** | A | `hn.algolia.com/api/v1/search?query=<domain>&restrictSearchableAttributes=url,title` | title, date, author, points, id |
| **Own sitemap / blog** | B | `https://<apex>/sitemap.xml` → fetch each `/blog` URL | post titles + published dates |
| **Play Store listing** | Spine | scrape listing | install bracket, release date, rating count |
| **Meta Ad Library** | B | public web UI | whether and when they ran paid social |
| **TikTok Creative Center** | B | public web UI | same for TikTok |
| **Wikipedia pageviews** | Spine | pageviews REST API | traffic proxy for notable targets only |
| **Author RSS** | B | Medium / Substack / dev.to feeds | guest articles, founder writing |

### Tier 1 — free, needs an API key

The fix for §6.4. An afternoon of signups, no bot, no ban risk, better data than scraping would give.

| Source | Axis | Yields |
|---|---|---|
| **Reddit OAuth** | **B** + A | `reddit.com/user/<handle>/submitted.json` — *the founder's entire posting history in one call.* Plus domain-anchored search. |
| **YouTube Data API** | B + A | their channel's full upload history; keyword search for third-party reviews |
| **Product Hunt GraphQL** | Spine | launch date, tagline, makers, upvotes |
| **GitHub API** | B | open-source-as-marketing, launch-adjacent commits |

### Tier 2 — cheap paid

| Source | Axis | Yields |
|---|---|---|
| **ListenNotes** | A + B | transcript/description search — catches mentions that produced no link and are invisible to Google. Proven on HabitKit. Also finds guest appearances by *person* name. |
| **Brave Search API** or **SerpAPI** | A | open-web mention sweep; category listicles ("best habit tracker") |
| **Common Crawl** | A | backlinks — everyone who linked, with the linking page's date. Free data, heavy compute. |

### Tier 3 — logged-in browsing (last resort)

| Source | Axis | Note |
|---|---|---|
| **X / Twitter** | **B** | The only source that genuinely requires it. Historical search is gated; logged-out pages barely render. |
| **Indie Hackers** | B | No API; scrape. High-value for indie targets — milestones and "how I got my first 1000 users" posts. |
| **Archived App Store pages** | Spine | Not an auth problem — a timeout problem. Belongs here for scheduling reasons only. |

### Tiering discipline

Free unauthenticated → free key → cheap paid → logged-in browsing. **Never browse what a key can fetch.** Reddit, YouTube and Product Hunt look like "auth required" but hand you a proper API; using the expensive tier on them wastes cost, adds fragility, and returns worse-structured data.

### X strategy: partial by design

Burner accounts work for a demo and fail at scale. X requires phone verification for new accounts and detects VOIP numbers; fresh account + datacenter IP + automation is flagged fast; and one account scraping a thousand founder profiles looks exactly like a bot and gets suspended — after which **a human must manually log a new one in.** Pipeline uptime becomes dependent on manual re-auth, which is not a foundation.

Therefore X ships as `coverage: partial` **by design**, so a thin timeline never silently reads as "they did no marketing." Preferred substitutes, in order:

1. **Wayback snapshots of X profiles and tweets** — free, no account, no ToS exposure, and the only route to since-deleted or gated content. Patchy; better pre-2023.
2. **Cross-posted content.** Indie founders repeat themselves: a milestone tweet almost always also appears on Indie Hackers, in a Reddit post, or in a podcast interview. ListenNotes already found HabitKit's revenue claim this way. X's marginal value is lower than it looks.
3. **A paid aggregator** (Apify actor, Bright Data) — they hold the ban risk, you hold no accounts.
4. **Logged-in burner browsing** — the fragile tail, never the foundation.

Logged-in scraping of X violates its ToS. That is an operational and compliance fact to decide on deliberately, not a detail to discover later.

### Auth, limits and cost — partially verified

> **PARTIAL.** The `Auth` column is established. **`Rate limit` and `Cost` are still unverified** — a research pass was interrupted by throttling. Do not build scheduling or budget assumptions on this table until those two columns are filled with cited, current figures. Everything moves; Reddit and X pricing has changed repeatedly.

| Source | Auth | Rate limit | Cost | Notes |
|---|---|---|---|---|
| Wayback CDX + captures | none | **UNVERIFIED — throttles hard, see §9.9** | free | **429s observed in testing.** The spine of the product. |
| iTunes lookup/search | none | UNVERIFIED | free | Undocumented but stable for years. Also does `entity=podcast`. |
| HN Algolia | none | UNVERIFIED | free | Verified working. Use `restrictSearchableAttributes=url,title`. |
| Wikipedia pageviews | none | UNVERIFIED | free | Official, documented. |
| Common Crawl index | none | n/a (bulk) | free | Heavy to query; S3 + columnar index. |
| RSS (Substack/Medium/dev.to) | none | n/a | free | Founder's written output. |
| Meta Ad Library | none for web UI | n/a | free | **Official API is believed restricted to political/issue ads; the public web UI covers all advertisers.** UNVERIFIED — decides whether "did they run paid ads" is a browse target or an API one. |
| TikTok Creative Center | none | UNVERIFIED | free | Public web. |
| Play Store listing | none | UNVERIFIED | free | No official API. Scrape, or `google-play-scraper` (maintenance status UNVERIFIED). |
| Google Trends | none official | UNVERIFIED | free / paid via SERP | **No official API.** Unofficial clients throttle aggressively. |
| Reddit API | **free OAuth app** | UNVERIFIED | free tier exists | **The fix for the §6.4 failure.** One call returns a user's whole post history. |
| YouTube Data API v3 | **free key** | UNVERIFIED (quota units) | free tier | Search costs more units than list calls. |
| Product Hunt GraphQL | **free token** | UNVERIFIED | free tier | |
| GitHub API | free token | UNVERIFIED | free | Token mainly raises the rate limit. |
| ListenNotes | **paid key** | UNVERIFIED | paid | Transcript search — the one paid source already proven on HabitKit. |
| Brave Search API | paid key | UNVERIFIED | free tier + cheap paid | Independent index; preferred for the Axis A sweep. |
| SerpAPI | paid key | UNVERIFIED | paid | Fallback / Google-specific verticals. |
| Crunchbase | paid key | UNVERIFIED | expensive | Company-mode only. Likely out of scope for v1. |
| App Store page (JSON-LD) | none | UNVERIFIED | free | **Embeds `aggregateRating` in server-rendered JSON-LD** — see §13.1. Source of the growth curve. |
| App Store version history | none — no endpoint | n/a | free | No API. **Recovered as a sampled series** from release notes in archived captures (§13.1). |
| X / Twitter | **login + browse** | n/a | account risk | Tier 3, `partial` by design. See §7 X strategy. |

---

## 8. Architecture

### 8.1 Pipeline

```
domain/name
    │
    ├─ (0) IDENTITY RESOLUTION ─────► app{}     ← iTunes; everything depends on this
    │
    ├─ (1) SPINE      Wayback CDX + captures, store lookups, sitemap
    │                 → events(product_change, launch, aso) + metrics
    │
    ├─ (2) AXIS B     enumerate founder accounts: reddit history, YT channel,
    │                 IH profile, GitHub, RSS, podcast-by-person
    │                 → events(by_founder: true)
    │
    ├─ (3) AXIS A     domain-anchored sweep: HN, reddit search, Brave/SerpAPI,
    │                 ListenNotes, YT keyword, backlinks
    │                 → events(by_founder: false)
    │
    └─ (4) MERGE      dedupe by url → sort by date → write coverage{}
                      → shape.json
```

Axis B before Axis A: fewer calls, higher yield, no noise filtering. Axis A is where cost and noise both live, so it is the natural thing to build last.

### 8.2 Browsing runtime — vendor `agent-computer/` from CopilotKit/OpenBot

[CopilotKit/OpenBot](https://github.com/CopilotKit/openbot) is MIT-licensed. **Take the `agent-computer/` directory; skip the platform.** It is self-contained — own Dockerfile, own `package.json`, own test suite — and its design brief is exactly our Tier 3.

| File | What it gives us |
|---|---|
| `src/profiles.ts` | Persistent Chromium profiles via Playwright `launchPersistentContext` against a real user-data dir on a mounted volume — deliberately *not* cookie-JSON snapshots, because those miss IndexedDB, service workers, and anything written after the snapshot. **Log a session in once by hand; it survives container restarts.** This is the X problem solved. |
| `src/egress.ts` | Per-bot proxy via `EGRESS_PROXY_<BOT_ID>`, credentials split out of the URL. Residential proxy per target, built in. |
| `src/aria-snapshot.ts` | Playwright `mode: "ai"` accessibility tree parsed into a flat element list, capped at 200 elements. Reading pages as structured text rather than screenshots is dramatically cheaper in tokens — this is what makes scrolling a long timeline economically viable. |
| `src/shell.ts` | A real shell in the bot's workspace. **The same container that scrolls X can `curl` Wayback, HN Algolia and iTunes, and write everything to one volume.** |
| `screencast.ts` / `viewer.ts` / `live-page.ts` | Watch a session live — how you debug a scraper that broke because a site changed, and how a human performs the one-time X login. |
| `docs/routines.md` | Scheduled standing work (15-minute floor) — the moving-window re-crawl. |

**This collapses the two pipelines into one.** The free HTTP tier and the browse tier were designed as separate systems; they don't have to be. One container, one output directory.

Friction, stated plainly:

- The full platform depends on **CopilotKit Intelligence** (`INTELLIGENCE_API_KEY`) for durable threads and memory — free plan, self-hostable, but an external service in the critical path. A reason to take the directory and skip the platform: the browser container doesn't need it.
- **Container-per-bot needs the supervisor**, which holds the Docker socket. Without `COMPUTER_SUPERVISOR_URL`, all bots share one computer — so per-target isolation costs a privileged component.
- Governance is not free value: the CEL policy engine fails closed, but the shipped default is `deny: [] / allow: ["true"]` — it permits everything until rules are written.
- **Alpha**, Bun 1.3+.

Its `tests/` directory is the real tell: `follows-popup.test.ts`, `browser-eviction.test.ts`, `headed-browser.test.ts`, `virtual-display.test.ts`. Someone already fought these bugs.

### 8.3 Storage — freeze history, move the window

**Historical data is immutable.** HabitKit's Feb 2023 Product Hunt launch will never change. This does most of the architectural work:

- The expensive tier is a **one-time ingestion cost per target**, not a per-query cost.
- Agent latency stops mattering — a six-minute browse session is fine if it happens once, ever.
- The product is therefore **a database that accumulates**, not a live tool that fetches on demand.

"Up until current day" means the timeline never closes: history is frozen after one crawl, and only the trailing few months stay live and get re-checked. The expensive tier only ever runs on the cheap part.

---

## 9. Risks

### 9.1 Identity resolution failing silently — the top risk

A wrong `ios_id` produces a complete, plausible, well-cited timeline **about the wrong product.** This is not hypothetical: the App Store now contains a second, unrelated app called **"HabitKit: Focus Habit Tracker"** (different developer, released 2026-03-30). Even the store name is ambiguous; only the id is a safe key.

Mitigation: resolve by domain wherever possible; cross-check `sellerName` against the site; treat a name-only match as unresolved rather than as a guess; surface the resolved identity prominently in the output so a human can catch it immediately.

### 9.2 Ambiguous brand names

Measured at four orders of magnitude in §6.3. Mitigated by domain-anchored search. Bare-name search becomes an opt-in extra for names distinctive enough to survive it, never the default.

### 9.3 "Nothing happened" vs. "we didn't look"

Chronological presentation is uniquely dangerous here — an empty stretch *asserts something*. The `coverage` block is the mitigation and it is not optional.

### 9.4 Non-app targets have far weaker metrics — deferred, not live

Store review counts and install brackets are the highest-quality data in the catalogue, and a pure SaaS or website has neither; those targets fall back to Wayback self-claims and Google Trends, which are much thinner. **Not a v1 risk** — §11.1 scoped v1 to apps only. This becomes live again when the company/website mode is built.

### 9.5 Most growth is not spiky

The dominant real pattern for successful indie apps is ASO plus compounding word-of-mouth: a smooth curve with no attributable event anywhere on it. A system that cannot report *"nothing here explains this; it grew steadily and the visible events look like noise"* will manufacture narratives to fill the page. Being able to return that verdict is what separates this from retrofitted teardown blogging. (Relevant once attribution lands post-v1; worth designing the output not to imply causation before then.)

### 9.6 Wayback capture density is biased

The archive crawls popular sites more often, so capture frequency correlates with attention — useful as a weak signal, but it also means sparse early history for exactly the pre-traction period that is most interesting.

### 9.7 ToS and operational fragility on X

Covered in §7. Summary: X is `partial` by design and must never be a hard dependency.

### 9.8 `agent-computer` is alpha

Vendored, not depended on as a package — the repo publishes nothing to a registry and expects to be cloned and made your own. Pin the commit.

---

### 9.9 Archive.org throttling — a first-order constraint

**Discovered in testing, not anticipated.** After a moderate burst of requests, `archive.org` returned **HTTP 429** for *every* query including ones that had succeeded minutes earlier. The App Store CDX call previously recorded as "timed out at 40s" was most likely throttling, not query cost.

This is architectural, not incidental: Wayback is the **spine** of Tier 0 and the source of both the positioning timeline (§6.2) and the growth curve (Phase 3). If it throttles, the free tier stops.

Consequences for the build:
- Request pacing, exponential backoff and 429 handling are **Phase 1 requirements**, not hardening.
- Per-target crawl budgets, so one target cannot exhaust the IP's allowance.
- **The `agent-computer` per-bot egress proxies apply to the free tier too**, not just to logged-in browsing — this strengthens the §8.2 vendoring case.
- Crawl-once / freeze-history (§8.3, Phase 6) becomes more valuable than the cost model alone suggested: it reduces lifetime request count against the one host that rate-limits us.

**Untested workaround, worth trying first in Phase 3:** replace the single broad CDX scan with N calls to the availability API (`archive.org/wayback/available?url=…&timestamp=…`) at quarterly dates. Many small fast lookups instead of one large scan. This could not be tested — the throttle was already active.

## 10. Roadmap

| Phase | Deliverable | Gate |
|---|---|---|
| **0 — Identity** | `domain` + name → `app{}` block. iTunes search/lookup, cross-checked against the site. | Resolves HabitKit correctly *and* rejects the impostor HabitKit |
| **1 — Spine (Tier 0)** | Automated Wayback CDX + capture diffing → `product_change` events; store lookups → `metrics` snapshot; sitemap → `own_content`. Handle gzip, apex-vs-www, redirects. | **Reproduces the §6.2 pivot timeline automatically, zero cost** |
| **2 — Axis B (Tier 1)** | Reddit OAuth, YouTube, Product Hunt, GitHub keys. Enumerate founder accounts → `by_founder: true` events. | Founder playbook for HabitKit, ordered |
| **3 — Growth curve** | Fix the App Store CDX timeout (try the availability-API A/B, §9.9). Archived store pages → regex JSON-LD → `metrics` **time series**. **No browser needed** (§13.1). Play install brackets. | `metrics` has ≥8 dated points for HabitKit |
| **▶ v1 MILESTONE** | **Phases 0–3.** One command, one target, real timeline + real growth curve + coverage report. Cost: a handful of free API keys. | Reviewed against a second, non-HabitKit target |
| **4 — Axis A (Tier 2)** | ListenNotes, Brave/SerpAPI, backlinks. Third-party mentions with noise filtering. | Mention events survive a precision spot-check |
| **5 — Browse (Tier 3)** | Vendor `agent-computer/`, thin orchestrator, one-time manual X login via the live viewer. X `partial`. Ad libraries. **Scope shrank to X + ad libraries only** (§13.1). | X adds events without becoming a dependency |
| **6 — Freeze & incremental** | Crawl-once storage, frozen history, moving-window re-crawl on a routine. | Second run on the same target is near-free |
| **7 — Analysis** | The deferred §4 items, in order: eras → causal edges → attribution → founder-claim contradiction. | Requires dense metrics from Phase 3 |

**Build Phase 1 before paying for anything.** Six free sources already produced a pivot the manual draft missed. The test for whether Tier 3 is needed at all: build without X first and see whether the timelines are already good.

---

## 11. Open questions

### 11.1 Scope — DECIDED: apps only for v1

**Decided 2026-09-11 (DECISIONS.md D1): v1 supports mobile apps with an App Store or Play listing. Nothing else.**

Every high-value source verified in §6 and §13.1 is app-specific — the free iTunes call that yields the founder's name and exact release date, the JSON-LD `aggregateRating` that yields the growth curve, the archived listings that yield version history. A pure SaaS or website has none of it.

This deliberately narrows the audience described in §3. Companies and websites are a **post-v1 mode**, and they are genuinely a second pipeline sharing this one's spine: for an indie app the founder *is* the primary source (build-in-public posts, PH, HN, Reddit, podcasts), whereas for a company the founder's posts are PR and the real record is press, funding rounds, Crunchbase, the engineering blog and job postings. Wayback landing-page diffing is the part that works at both ends. Which mode a target is becomes a routing decision at ingestion — but not in v1, where there is only one mode.

**Consequences now settled:** identity resolution is store-first; `metrics` has exactly one path; §9.4 and §11.4 are deferred rather than blocking.

### 11.2 Faithful record, or judgement?

Should the tool eventually say *"the founder credits Product Hunt; the data suggests it was the Reddit thread"* — or stay a faithful reconstruction and leave judgement to the reader? Founders systematically misattribute their own growth, so the disagreement is arguably the most valuable output in the system. Same pipeline either way; deferred to Phase 7, but it shapes how the output is framed.

### 11.3 Output surface

`shape.json` is the contract. Undecided: CLI, API, or rendered page — and whether the primary artifact is a readable narrative or queryable data.

### 11.4 Where does the growth curve come from for non-app targets?

`metrics` has no working proxy for websites. Candidates: landing-page self-claims via Wayback diff, Google Trends, headcount over time — all weaker than store data. **Deferred with the company/website mode (§11.1); no longer blocking.**

### 11.5 Storage engine

Two flat tables and immutable history — nearly anything works. Deferred until Phase 6, but Postgres is the obvious default given the freeze/window pattern.

---

## 12. Stack

Three constraints decide it: `agent-computer` is TypeScript + Bun + Playwright; the `events`/`metrics` schema is written by ~10 scrapers and read by the UI, so defining it once and typed is worth a lot; and jobs run for minutes under global per-host rate limiting.

**TypeScript end to end.** One language, shared types between scrapers and UI, no bridge to the browse container. Python would give better analysis tooling, but v1 has no analysis.

| Layer | Pick | Why |
|---|---|---|
| App + API | Next.js (App Router) | Search form, job page, API routes, one deploy |
| Language | TypeScript | Matches `agent-computer`; shared `Event`/`Metric` types |
| DB | Postgres | Job state, events, metrics, coverage |
| Driver | `postgres` + `lib/db/schema.sql` | See §12.5 — Drizzle was dropped |
| Queue | **own `source_runs` table**, `FOR UPDATE SKIP LOCKED` | See §12.5 — pg-boss was dropped |
| Fetching | native `fetch` / undici | Nothing more is needed |
| Parsing | see §13 | |
| Browse | vendored `agent-computer` | Playwright + Chromium, loopback + token |
| LLM | `@anthropic-ai/sdk` | §12.3 |
| Styling | Tailwind | |
| Local dev | Docker Compose | Postgres + agent-computer + app + worker |
| Prod | Fly.io or Railway | Long-running processes required |

### 12.1 The serverless trap

**Workers must not run on serverless functions.** A cold crawl is minutes of paced Wayback fetches; functions time out, and a per-invocation model cannot hold a global token bucket. Next.js on Vercel is fine for UI and API, but workers need a persistent process. Simplest: one Fly/Railway box, no split.

### 12.2 Layout

```
viraly/
  app/                    Next.js — form, job page, api routes
  packages/
    schema/               Event, Metric, Coverage — single source of truth
    sources/              one module per source, all → Event[] | Metric[]
      itunes.ts  wayback.ts  hn.ts  reddit.ts  sitemap.ts  …
    queue/                pg-boss setup, per-host throttles, ratelimiter
    db/                   drizzle schema + migrations
  worker/                 pulls jobs, calls sources/, writes rows
  agent-computer/         vendored from CopilotKit/OpenBot (MIT)
  docker-compose.yml
```

Every `sources/` module has one signature — `(app: AppIdentity) => Promise<Event[] | Metric[]>` — so a new source is one file plus a queue registration, each independently testable against a saved fixture.

**The job table and the `coverage` block are the same object.** One row per `(target, source)` with status, attempts and error. The worker writes it; the UI reads it as the coverage report. Building these twice is how coverage drifts from reality, which defeats its purpose.

**The rate limiter is global, in Postgres** — one token bucket per host, shared by all workers. Concurrent searches must not 429 each other (§9.9).

### 12.3 Where the LLM goes

Four narrow jobs, none of them orchestration: relevance-filtering search hits, turning a Wayback diff into "positioning changed from X to Y", assigning `kind`, and driving browse sessions. **~90% of the pipeline is deterministic HTTP and parsing — no agent belongs in the orchestration path.**

Default `claude-opus-5` with `thinking: {type: "adaptive"}`. Two features fit unusually well:

- **Batch API (50% off)** — relevance-filtering hundreds of mention hits is latency-insensitive and already queued.
- **Structured outputs** (`output_config.format` / `messages.parse()`) — extractors return `Event` rows against a fixed schema, so validated output is the contract, not a nicety. Plus prompt caching on the classifier's stable prefix.

Stepping the high-volume relevance filter down to a cheaper model is the obvious cost lever if measurement calls for it — a decision to make on numbers, not upfront.

### 12.5 Two deviations, decided at E2

**pg-boss dropped.** It owns its own queue tables, which would have left pg-boss's job state *and*
our coverage table as two separate records of what a crawl did — the exact duplication §12.2 warns
against. Instead one `source_runs` table, claimed with `FOR UPDATE SKIP LOCKED` (the standard
Postgres queue primitive, ~80 lines). "The job table *is* the coverage block" is now literally true
rather than aspirational: `readCrawl` renders the same rows the worker claims.

**Drizzle dropped.** The interesting queries — `SKIP LOCKED`, the atomic token bucket — are
hand-written SQL regardless, leaving an ORM to do trivial inserts. Six tables in a single idempotent
`schema.sql` applied on worker start. A migration tool is not yet earned; it becomes worth adding when
the schema has to change without dropping data.

### 12.4 Deliberately excluded

No Redis, no Temporal/Inngest, no tRPC, no microservices, no LLM in the orchestration path, no ORM, no queue library.

---

## 13. Parsing

**~60% of sources return JSON** (CDX, iTunes, HN, Reddit, YouTube, PH, Wikipedia) and need no parser. The parsing problem is only the HTML sources, and it splits into three lanes.

### 13.1 Lane 1 — JSON, including JSON embedded in HTML

**Rule: hunt for embedded JSON before touching the DOM.** JSON-LD, `__NEXT_DATA__`, inline state blobs. More stable than the rendered DOM, more complete, cheaper. This is the first thing every HTML fetcher tries.

**Verified on the live App Store page:**

```json
"aggregateRating": { "ratingValue": 4.9, "reviewCount": 2410 }
```

Server-rendered JSON-LD in a `<script>` tag — one regex plus `JSON.parse`. Consequences:

- **The growth curve needs no browser and no DOM parser.** Phase 3 becomes: fetch N archived captures, regex the JSON-LD, read `reviewCount`.
- The page's serialized state blob carries the current version's **release notes**, so archived captures yield a *sampled version history with dates* — closing the §7 gap without an API.
- **Tier 3 shrinks to X and the ad libraries.** Everything else is plain HTTP.

> **UNVERIFIED:** that archived Wayback copies also contain the JSON-LD. It is server-rendered, so this is highly likely, but archive.org throttling (§9.9) blocked confirmation. **Verify this first in Phase 3** — the phase plan depends on it.

### 13.2 Lane 2 — semantic HTML → markdown → LLM

Archived landing pages and blog posts. **CSS selectors cannot do this job**: no selector finds "the headline" across 37 captures spanning five years and multiple site rewrites (HabitKit's own site moved to Tailwind+Alpine partway through). What worked in the §6.2 test run was strip-to-text then read it with a model.

| Tool | For |
|---|---|
| `@mozilla/readability` | blog posts — title, byline, published date, content. Firefox Reader Mode's engine. |
| `turndown` | HTML → markdown for LLM input; preserves structure at a fraction of HTML's tokens |
| `linkedom` | when a real DOM is genuinely needed — faster and more spec-compliant than cheerio |
| `fast-xml-parser` | sitemaps. Trivial and stable. |
| `cheerio` | **demoted to surgical jobs only** — grab the JSON-LD script tag, pull meta tags, collect `<loc>`. Never semantic extraction. |

### 13.3 Lane 3 — JS-only pages

X, ad libraries, Indie Hackers. `agent-computer`'s `aria-snapshot.ts` (Playwright `mode: "ai"` accessibility tree, capped at 200 elements).

### 13.4 Stagehand and AI browsers — considered, not adopted

`extract()` with a schema over natural language is a real tool and resilient to layout change in a way selectors never are. Three reasons against it here:

1. **Non-determinism conflicts with the archive model.** Re-crawling a target should produce identical rows; an LLM call per extraction drifts between runs, and there is no clean way to distinguish a real site change from model variance.
2. **Cost and latency on the wrong axis.** 37 captures × N targets × one LLM call each, to extract a headline that a text-strip plus *one batched* call already gets (§12.3).
3. **We already vendored the primitive it builds on** — Playwright `mode: "ai"` aria snapshots. Adopting it means a second browser abstraction for something in the repo.

Same reasoning for Firecrawl and Jina Reader: hosted HTML→markdown, replacing plumbing `turndown` does locally for free.

**Where to reconsider:** if lane 3 proves painful in Phase 5 — X's timeline structure shifting, ad libraries fighting extraction — schema-based `extract()` would beat hand-written aria traversal. Scoped to the hostile pages only, not the pipeline.
