# Review policy

What a reviewer checks, in priority order. These are ranked by how badly the failure damages the
product, not by how hard they are to spot.

## 1. No invented data

Every `Event.url` must be a real URL that was actually fetched. No placeholder ids, no guessed dates,
no illustrative examples presented as findings. An unknown field is `null`, and `coverage` says why.

*Why first:* the product's entire value is that its claims are checkable. One fabricated row makes
every other row suspect. The first draft fixture of this project contained two invented App Store
ids; both were wrong, and nothing in the output would have revealed it.

## 2. Every source writes a coverage row — on success and on failure

A source that can return nothing without recording it is a silent failure, and silent failure is the
characteristic break of this system: the site changed, nothing threw, and a gap appears in the
timeline that reads as "they went quiet."

`failed`, `empty`, `partial` and `ok` are four different facts. Collapsing them loses the
distinction between "we could not look" and "we looked and there is nothing."

## 3. No network in tests

The eval suite runs against recorded fixtures through `replayCtx`. A test that reaches the network is
not a test — it is a live probe that will fail for reasons unrelated to the code. `replayCtx` throws
on any unrecorded URL; that guard must not be weakened.

## 4. Golden output is not a rubber stamp

`npm run golden` regenerates expected output. Running it to make a failing test pass destroys the
suite's purpose. Regenerate only when the changed output *is* the intent of the work, and say so in
the commit.

## 5. Nothing bypasses the rate limiter

Sources fetch through `Ctx`, never through global `fetch`. From E2 the per-host token bucket lives in
`liveCtx`, so a direct call is both unthrottled and untested. archive.org throttles by IP and will
start returning 429 for queries that worked minutes earlier (PRD §9.9).

## 6. `agent-computer/` is frozen

Vendored MIT code from CopilotKit/OpenBot (E7). Upstream owns it. Changes belong in the orchestrator
around it.

## 7. Schema discipline

Do not add `confidence`, `eras`, `edges` or `findings` to `lib/schema.ts`. All four are deferred
deliberately (PRD §4) — they are analysis over a complete event list, and the list must exist first.

## Then: ordinary correctness, then simplification.

Say plainly when a diff is clean. Do not manufacture findings to look useful.
