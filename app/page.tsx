"use client";

import { useState } from "react";
import type { Candidate } from "@/lib/schema";
import type { CrawlProgress } from "@/lib/crawl";
import { CandidateList } from "@/components/CandidateList";
import { Timeline } from "@/components/Timeline";
import { CoverageReport } from "@/components/CoverageReport";
import { GrowthChart } from "@/components/GrowthChart";
import { InsightsPanel } from "@/components/Insights";

type Stage = "idle" | "resolving" | "choosing" | "crawling" | "done";

export default function Home() {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [result, setResult] = useState<CrawlProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
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
    <main className="mx-auto max-w-2xl px-6 py-16">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">viraly</h1>
          <p className="mt-1 text-[var(--color-muted)]">
            How did this app actually grow? Reconstructed from public sources.
          </p>
        </div>
        <a href="/compare" className="shrink-0 text-sm underline decoration-[var(--color-line)] underline-offset-4">
          compare
        </a>
      </header>

      <form onSubmit={resolve} className="mt-8 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="App name — try HabitKit"
          aria-label="App name"
          className="flex-1 rounded-lg border border-[var(--color-line)] bg-white px-4 py-2.5 outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-ink)]"
        />
        <button
          type="submit"
          disabled={stage === "resolving" || !query.trim()}
          className="rounded-lg bg-[var(--color-ink)] px-5 py-2.5 font-medium text-[var(--color-paper)] disabled:opacity-40"
        >
          {stage === "resolving" ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="mt-4 rounded-lg border border-[var(--color-accent)] px-4 py-3 text-sm text-[var(--color-accent)]">
          {error}
        </p>
      )}

      {stage === "choosing" && candidates.length === 0 && (
        <p className="mt-8 text-[var(--color-muted)]">
          No apps matched “{query}”. Try a different spelling.
        </p>
      )}

      {(stage === "choosing" || stage === "crawling") && candidates.length > 0 && (
        <CandidateList candidates={candidates} onPick={crawl} />
      )}

      {stage === "crawling" && !result && (
        <p className="mt-6 text-sm text-[var(--color-muted)]">Resolving…</p>
      )}

      {(stage === "done" || stage === "crawling") && result && (
        <>
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

          <section className="mt-10">
            <h2 className="text-sm font-medium text-[var(--color-muted)]">Timeline</h2>
            {result.pending === 0 && result.attribution && (
              <p className="mt-1 text-sm text-[var(--color-muted)]">{result.attribution}</p>
            )}
            <Timeline entries={result.timeline} />
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
        </>
      )}
    </main>
  );
}
