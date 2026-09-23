/**
 * The seam between a source module and the outside world.
 *
 * Every source takes a `Ctx` instead of calling `fetch` directly. That buys three things:
 *
 *  1. **Offline tests.** `replayCtx()` serves recorded fixtures, so the eval suite runs with zero
 *     network calls — which is what makes it a test rather than a live probe (EPICS.md E1).
 *  2. **A deterministic clock.** `userRatingCount` is read "today", so without an injectable `now`
 *     the golden output would change every day and the suite would be useless.
 *  3. **One chokepoint for rate limiting.** At E2 the global per-host token bucket goes in
 *     `liveCtx`, and every source is throttled by construction rather than by remembering to.
 *
 * This is not test-only scaffolding — it is where the limiter has to live anyway (PRD §12.2).
 */

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface Ctx {
  /** Fetch a URL as text. Throws on network failure or non-2xx. */
  fetchText(url: string): Promise<string>;
  /** The current date, injectable so golden output stays stable. */
  now(): Date;
  /**
   * Report progress from inside a long source. Optional and fire-and-forget: a source must work
   * identically when nobody is listening, which is how the offline suite stays deterministic.
   */
  progress?: (note: string) => void;
}

/**
 * The HTTP status carried by a thrown fetch error, or `null` when it carries none.
 *
 * The distinction matters wherever absence is evidence. A 404 is the server stating that a URL is
 * gone; a timeout, a 5xx, a DNS failure or a missing fixture are all "we could not look" wearing
 * the same `catch` block. Treating the second group as the first turns every bad minute into a
 * confident claim that a page was deleted.
 */
export function httpStatus(err: unknown): number | null {
  const message = err instanceof Error ? err.message : String(err);
  const m = /\s([1-5]\d\d)\s/.exec(message);
  return m ? Number(m[1]) : null;
}

export const FIXTURE_DIR = path.join(process.cwd(), "fixtures");

/** Fixtures are keyed by a hash of the URL — URLs contain characters filenames should not. */
export function fixtureKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export interface ManifestEntry {
  url: string;
  /** `null` when what was recorded is a refusal — there is no body to serve. */
  file: string | null;
  recorded_at: string;
  status: number;
  bytes: number;
  /**
   * The error a recorded non-2xx produced, replayed verbatim.
   *
   * A 404 is a fact about the site, not a gap in the fixtures, and the two were previously
   * indistinguishable offline: both surfaced as "no fixture". Anything that reasons about a page
   * being *gone* needs to tell them apart.
   */
  error?: string;
}

export type Manifest = Record<string, ManifestEntry>;

/**
 * Per-host request timeouts.
 *
 * archive.org's CDX endpoint answers the same trivial query in 5s or 17s depending on load, and a
 * capture can be 800KB over a deliberately throttled connection. A single global timeout either
 * strangles it or lets a dead iTunes call hang for a minute.
 */
/**
 * Identify the crawler honestly.
 *
 * Sending no User-Agent is not neutral — some services reject it outright. rdap.org returns 403 to a
 * headerless request and 200 to an identified one. Naming ourselves also gives an operator something
 * to block or contact if we misbehave, which a spoofed browser string does not.
 */
export const USER_AGENT = "viraly/0.1 (+https://github.com/devHaitham481/viraly)";

export const HOST_TIMEOUT_MS: Record<string, number> = {
  "web.archive.org": 90_000,
  "archive.org": 90_000,
};

export interface LiveOptions {
  timeoutMs?: number;
  progress?: (note: string) => void;
  /** Per-host rate limiting. Supplied by the worker; see lib/queue/limiter.ts. */
  acquire?: (host: string) => Promise<void>;
}

/** Real network, real clock. Used by the app and the worker. */
export function liveCtx({ timeoutMs = 15_000, acquire, progress }: LiveOptions = {}): Ctx {
  const budgetFor = (host: string) => HOST_TIMEOUT_MS[host] ?? timeoutMs;

  async function fetchOnce(url: string): Promise<string> {
    const host = new URL(url).host;
    // Global, cross-process. Two concurrent crawls must not 429 each other (PRD §9.9).
    if (acquire) await acquire(host);

    const res = await fetch(url, {
      signal: AbortSignal.timeout(budgetFor(host)),
      headers: {
        accept: "application/json, text/javascript, */*",
        "user-agent": USER_AGENT,
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${host} ${res.status} ${res.statusText} — ${url}`);

    // Wayback's `id_` raw mode returns the ORIGINAL bytes — often gzipped, with no
    // Content-Encoding header for fetch to act on. Sniff the magic number and inflate.
    const buf = Buffer.from(await res.arrayBuffer());
    const body = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
    return body.toString("utf8");
  }

  return {
    async fetchText(url) {
      try {
        return await fetchOnce(url);
      } catch (err) {
        // "The operation was aborted due to timeout" is useless in a coverage row — it names
        // neither the host nor what we were reading. Say both.
        if (err instanceof Error && /abort|timeout/i.test(err.message) && !err.message.includes(" — ")) {
          throw new Error(`timeout after ${budgetFor(new URL(url).host) / 1000}s — ${url}`);
        }
        throw err;
      }
    },
    now: () => new Date(),
    progress,
  };
}

/**
 * Recorded fixtures, frozen clock. Used by the eval suite.
 *
 * An unrecorded URL is a hard error rather than a silent passthrough — a test that quietly reaches
 * the network is not a test, and this is the only thing enforcing that.
 */
export function replayCtx(manifest: Manifest, frozenNow: string, dir = FIXTURE_DIR): Ctx {
  return {
    async fetchText(url) {
      const entry = manifest[fixtureKey(url)];
      if (!entry) {
        throw new Error(
          `no fixture for ${url}\n` +
            `  This test tried to reach the network. Record it with: npm run record`,
        );
      }
      // A recorded refusal is replayed as one. Serving a body here, or reporting "no fixture",
      // would both tell a source that a page it can prove is gone merely went unrecorded.
      if (entry.file === null || entry.status < 200 || entry.status >= 300) {
        throw new Error(entry.error ?? `${new URL(url).host} ${entry.status} — ${url}`);
      }
      return readFile(path.join(dir, entry.file), "utf8");
    },
    now: () => new Date(frozenNow),
  };
}

export async function loadManifest(dir = FIXTURE_DIR): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
}
