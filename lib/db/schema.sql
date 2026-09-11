-- viraly schema. Applied idempotently on worker/app start; no migration tool.
-- Small enough that CREATE TABLE IF NOT EXISTS is honest and a migration runner is not yet earned.

CREATE TABLE IF NOT EXISTS targets (
  ios_id          text PRIMARY KEY,
  name            text NOT NULL,
  domain          text,
  play_id         text,
  founder         text,
  founder_source  text,
  artwork         text,
  store_url       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS crawls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ios_id      text NOT NULL REFERENCES targets(ios_id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The queue AND the coverage report. One object, deliberately (PRD §12.2):
-- building these separately is how coverage drifts from what actually happened.
CREATE TABLE IF NOT EXISTS source_runs (
  id           bigserial PRIMARY KEY,
  crawl_id     uuid NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  source       text NOT NULL,
  -- queued → running → ok | partial | empty | failed
  status       text NOT NULL DEFAULT 'queued',
  note         text,
  attempts     int  NOT NULL DEFAULT 0,
  run_after    timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  UNIQUE (crawl_id, source)
);

CREATE INDEX IF NOT EXISTS source_runs_claimable
  ON source_runs (run_after) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS events (
  id          bigserial PRIMARY KEY,
  crawl_id    uuid NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  date        date NOT NULL,
  kind        text NOT NULL,
  title       text NOT NULL,
  source      text NOT NULL,
  by_who      text,
  by_founder  boolean NOT NULL,
  url         text NOT NULL,
  number      bigint,
  date_exact  boolean NOT NULL
);

CREATE INDEX IF NOT EXISTS events_crawl_date ON events (crawl_id, date);

CREATE TABLE IF NOT EXISTS metrics (
  id        bigserial PRIMARY KEY,
  crawl_id  uuid NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  date      date NOT NULL,
  metric    text NOT NULL,
  value     text NOT NULL,
  url       text NOT NULL
);

-- Global per-host token bucket. Shared by every worker, because archive.org throttles by IP
-- and two concurrent crawls must not 429 each other (PRD §9.9).
CREATE TABLE IF NOT EXISTS host_buckets (
  host            text PRIMARY KEY,
  tokens          double precision NOT NULL,
  capacity        double precision NOT NULL,
  refill_per_sec  double precision NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Fetched HTTP bodies, keyed by URL.
--
-- The product's founding observation: history is immutable. A Wayback capture at a fixed timestamp
-- will never change, so it never needs fetching twice — which is what turns a re-crawl from 44
-- rate-limited archive.org requests into two. Postgres TOASTs the body column, so the text is
-- compressed on disk without any work here.
CREATE TABLE IF NOT EXISTS http_cache (
  url         text PRIMARY KEY,
  body        text NOT NULL,
  bytes       int  NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS http_cache_fetched ON http_cache (fetched_at);

-- Worker liveness.
--
-- Deployed without a worker, every crawl sits at `queued` forever while the UI shows a spinner —
-- indistinguishable from "this is slow". One row, updated on each poll, lets the app say so instead.
CREATE TABLE IF NOT EXISTS worker_heartbeat (
  id       int PRIMARY KEY DEFAULT 1,
  beat_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Additive migrations, applied on every worker start (PRD §12.5).
--
-- These MUST come after every CREATE above. `ADD COLUMN IF NOT EXISTS` guards the column, not the
-- table, and `applySchema` sends this file as a single multi-statement query that Postgres wraps in
-- one implicit transaction — so an ALTER against a not-yet-created table rolls back the entire file
-- and a fresh database ends up with almost no tables at all.
ALTER TABLE targets ADD COLUMN IF NOT EXISTS store_url text;
ALTER TABLE source_runs ADD COLUMN IF NOT EXISTS progress text;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS handles jsonb NOT NULL DEFAULT '{}'::jsonb;
