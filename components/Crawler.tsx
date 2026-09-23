"use client";

import { useState } from "react";
import type { Candidate } from "@/lib/schema";
import type { CrawlProgress } from "@/lib/crawl";
import { CandidateList } from "@/components/CandidateList";
import { Timeline } from "@/components/Timeline";
import { CoverageReport } from "@/components/CoverageReport";
import { GrowthChart } from "@/components/GrowthChart";
import { InsightsPanel } from "@/components/Insights";
import { Summary } from "@/components/Summary";

type Stage = "idle" | "resolving" | "choosing" | "crawling" | "done";

/** Names that resolve, so a visitor's first try is not a miss. */
const EXAMPLES = ["HabitKit", "ngl", "Bereal", "Duolingo"];

/**
 * The live crawl: search, disambiguate, poll, render.
 *
 * `children` is the landing content, and it shows only while the page is idle — a visitor reading
 * their own result should not have to scroll back through marketing to reach it. It is passed in
 * from the server component so the worked example stays prerendered rather than shipping as part
 * of this bundle.
 */
export function Crawler({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [result, setResult] = useState<CrawlProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(e: React.FormEvent) {
    e.preventDefault();
    // Focus rather than refuse. The button stays live on an empty field — greeting a first-time
    // visitor with a greyed-out primary action reads as a broken page, not as a hint.
    if (!query.trim()) {
      (e.currentTarget as HTMLFormElement).querySelector("input")?.focus();
      return;
    }
    setStage("resolving");
    setError(null);
    setResult(null);
    setCandidates([]);
    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "search failed");
      setCandidates(data.candidates);
      setStage("choosing");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("idle");
    }
  }

  async function crawl(c: Candidate) {
    setStage("crawling");
    setError(null);
    try {
      const res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ios_id: c.ios_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "crawl failed");
      // Identity lands immediately; queued sources fill in as the worker finishes them.
      await poll(data.crawl_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("choosing");
    }
  }

  async function poll(crawlId: string) {
    for (let i = 0; i < 200; i++) {
      const res = await fetch(`/api/crawl/${crawlId}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error ?? "poll failed");
      const data: CrawlProgress = await res.json();
      setResult(data);
      setStage(data.pending > 0 ? "crawling" : "done");
      if (data.pending === 0) return;
      await new Promise((r) => setTimeout(r, 1200));
    }
    setStage("done");
  }

  return (
    <>
      <div className="mx-auto max-w-xl">
        <form onSubmit={resolve} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="An app or company name"
            aria-label="App name"
            className="min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-white px-4 py-3.5 text-base shadow-sm outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-ink)] focus:ring-4 focus:ring-[var(--color-ink)]/5"
          />
          <button
            type="submit"
            disabled={stage === "resolving"}
            className="shrink-0 rounded-xl bg-[var(--color-ink)] px-6 py-3.5 font-medium text-[var(--color-paper)] transition hover:opacity-90 disabled:opacity-40"
          >
            {stage === "resolving" ? "Searching…" : "Reconstruct"}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-sm">
          <span className="text-[var(--color-muted)]">Try</span>
          {EXAMPLES.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setQuery(name)}
              className="rounded-full border border-[var(--color-line)] bg-white px-2.5 py-1 text-xs transition hover:border-[var(--color-ink)]"
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mx-auto mt-6 max-w-xl rounded-lg border border-[var(--color-accent)] px-4 py-3 text-sm text-[var(--color-accent)]">
          {error}
        </p>
      )}

      {stage === "choosing" && candidates.length === 0 && (
        <p className="mx-auto mt-8 max-w-xl text-center text-[var(--color-muted)]">
          No apps matched “{query}”. Try a different spelling.
        </p>
      )}

      {(stage === "choosing" || stage === "crawling") && candidates.length > 0 && (
        <div className="mx-auto max-w-2xl">
          <CandidateList candidates={candidates} onPick={crawl} />
        </div>
      )}

      {stage === "crawling" && !result && (
        <p className="mt-6 text-center text-sm text-[var(--color-muted)]">Resolving…</p>
      )}

      {(stage === "done" || stage === "crawling") && result && (
        <div className="mx-auto max-w-5xl">
          <section className="mt-12 border-t border-[var(--color-line)] pt-8">
            <div className="flex items-center gap-4">
              {result.app.artwork && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={result.app.artwork} alt="" className="size-14 rounded-xl" />
              )}
              <div>
                <h2 className="text-lg font-semibold">{result.app.name}</h2>
                <p className="text-sm text-[var(--color-muted)]">
                  {result.app.founder ?? "unknown developer"}
                  {result.app.domain && <> · {result.app.domain}</>}
                </p>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              {[
                ["iOS id", result.app.ios_id],
                ["Bundle", result.app.play_id],
                ["Founder via", result.app.founder_source],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-[var(--color-muted)]">{k}</dt>
                  <dd className="truncate font-mono text-xs">{v ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* A worker running older code claims runs it cannot execute. Name it. */}
          {result.worker_missing.length > 0 && (
            <div className="mt-6 rounded-lg border border-amber-600 px-4 py-3 text-sm">
              <p className="font-medium text-amber-700">The worker is running older code</p>
              <p className="mt-1 text-[var(--color-muted)]">
                It does not know {result.worker_missing.join(", ")}, so those sources fail rather
                than run. Restart it with <code className="font-mono">npm run worker</code>.
              </p>
            </div>
          )}

          {/* Queued work with no worker is not slowness — it is never going to happen. Say so. */}
          {result.pending > 0 && !result.worker_alive && (
            <div className="mt-6 rounded-lg border border-[var(--color-accent)] px-4 py-3 text-sm">
              <p className="font-medium text-[var(--color-accent)]">No worker is running</p>
              <p className="mt-1 text-[var(--color-muted)]">
                {result.pending} source{result.pending === 1 ? "" : "s"} are queued and nothing will
                pick them up. Start one with <code className="font-mono">npm run worker</code>, or
                deploy a worker process — Vercel alone cannot run it.
              </p>
            </div>
          )}

          {result.pending > 0 && result.worker_alive && (
            <div className="mt-6 rounded-lg border border-[var(--color-line)] bg-white px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
                Crawling — {result.coverage.filter((c) => c.status === "ok" || c.status === "empty" || c.status === "partial" || c.status === "failed").length} of {result.coverage.length} sources done
              </div>
              <ul className="mt-2 space-y-0.5 text-[var(--color-muted)]">
                {result.coverage
                  .filter((c) => c.status === "running" || c.status === "queued")
                  .map((c) => (
                    <li key={c.source}>
                      {c.status === "running" ? "▸" : "·"} {c.source}
                      {c.status === "running"
                        ? ` — ${c.progress ?? "started"}${c.elapsed_s != null ? ` (${c.elapsed_s}s)` : ""}`
                        : " — waiting"}
                    </li>
                  ))}
              </ul>
              {result.queue_ahead > 0 && (
                <p className="mt-2 text-xs text-[var(--color-muted)]">
                  {result.queue_ahead} job{result.queue_ahead === 1 ? "" : "s"} from other crawls are
                  ahead of this one in the shared queue.
                </p>
              )}
            </div>
          )}

          {result.pending === 0 && result.brief && (
            <Summary brief={result.brief} name={result.app.name} />
          )}

          <section className="mt-10">
            <h2 className="text-sm font-medium text-[var(--color-muted)]">Timeline</h2>
            {result.pending === 0 && result.attribution && (
              <p className="mt-1 text-sm text-[var(--color-muted)]">{result.attribution}</p>
            )}
            <Timeline steps={result.steps} />
          </section>

          {result.metrics.length > 0 && (
            <section className="mt-10">
              <h2 className="text-sm font-medium text-[var(--color-muted)]">Growth</h2>
              <GrowthChart metrics={result.metrics} events={result.events} />
              {result.metrics.filter((m) => m.metric === "ios_rating_count").length < 3 && (
                <p className="mt-2 text-xs text-[var(--color-muted)]">
                  Only a live reading so far — the dated series comes from archived App Store pages.
                </p>
              )}
            </section>
          )}

          {result.pending === 0 && result.insights && (
            <InsightsPanel insights={result.insights} name={result.app.name} />
          )}

          <CoverageReport
            coverage={result.coverage}
            queueAhead={result.queue_ahead}
            violations={result.violations}
          />
        </div>
      )}

      {stage === "idle" && children}
    </>
  );
}
