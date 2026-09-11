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
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface Ctx {
  /** Fetch a URL as text. Throws on network failure or non-2xx. */
  fetchText(url: string): Promise<string>;
  /** The current date, injectable so golden output stays stable. */
  now(): Date;
}

export const FIXTURE_DIR = path.join(process.cwd(), "fixtures");

/** Fixtures are keyed by a hash of the URL — URLs contain characters filenames should not. */
export function fixtureKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export interface ManifestEntry {
  url: string;
  file: string;
  recorded_at: string;
  status: number;
  bytes: number;
}

export type Manifest = Record<string, ManifestEntry>;

export interface LiveOptions {
  timeoutMs?: number;
  /** Per-host rate limiting. Supplied by the worker; see lib/queue/limiter.ts. */
  acquire?: (host: string) => Promise<void>;
}

/** Real network, real clock. Used by the app and the worker. */
export function liveCtx({ timeoutMs = 15_000, acquire }: LiveOptions = {}): Ctx {
  return {
    async fetchText(url) {
      // Global, cross-process. Two concurrent crawls must not 429 each other (PRD §9.9).
      if (acquire) await acquire(new URL(url).host);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json, text/javascript, */*" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${new URL(url).host} ${res.status} ${res.statusText}`);
      return res.text();
    },
    now: () => new Date(),
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
      return readFile(path.join(dir, entry.file), "utf8");
    },
    now: () => new Date(frozenNow),
  };
}

export async function loadManifest(dir = FIXTURE_DIR): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
}
