import type { Coverage } from "@/lib/schema";
import type { Violation } from "@/lib/audit";

const TONE: Record<Coverage["status"], string> = {
  ok: "text-emerald-700",
  partial: "text-amber-700",
  empty: "text-[var(--color-muted)]",
  failed: "text-[var(--color-accent)]",
  queued: "text-[var(--color-muted)]",
  running: "text-[var(--color-ink)]",
  blocked: "text-amber-700",
};

/** What each state actually means, for a reader who did not design the pipeline. */
const MEANING: Record<Coverage["status"], string> = {
  ok: "queried successfully",
  partial: "queried, but some of it could not be read",
  empty: "looked, and there is genuinely nothing",
  failed: "could not look",
  queued: "waiting for a worker",
  running: "in progress",
  blocked: "never ran — a prerequisite could not be resolved",
};

const PENDING = new Set<Coverage["status"]>(["queued", "running"]);

export function CoverageReport({
  coverage,
  queueAhead = 0,
  violations = [],
}: {
  coverage: Coverage[];
  queueAhead?: number;
  violations?: Violation[];
}) {
  const pending = coverage.filter((c) => PENDING.has(c.status)).length;

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium text-[var(--color-muted)]">Coverage</h2>
        {pending > 0 && (
          <span className="text-xs text-[var(--color-muted)]">
            {pending} of {coverage.length} still working
            {queueAhead > 0 && <> · {queueAhead} job{queueAhead === 1 ? "" : "s"} ahead in the queue</>}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm text-[var(--color-muted)]">
        What was queried, and what it returned. A gap in the timeline above means nothing unless the
        source below says <span className="font-medium">ok</span>.
      </p>

      <table className="mt-3 w-full text-sm">
        <tbody className="divide-y divide-[var(--color-line)]">
          {coverage.map((c) => (
            <tr key={c.source}>
              <td className="py-2 pr-4 align-top font-medium">{c.source}</td>
              <td className={`py-2 pr-4 align-top whitespace-nowrap ${TONE[c.status]}`}>
                <span title={MEANING[c.status]}>
                  {c.status === "running" && (
                    <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current align-middle" />
                  )}
                  {c.status}
                </span>
              </td>
              <td className="py-2 align-top text-[var(--color-muted)]">
                {c.status === "running"
                  ? [c.progress ?? "started", c.elapsed_s != null ? `${c.elapsed_s}s` : null]
                      .filter(Boolean)
                      .join(" · ")
                  : c.status === "queued"
                    ? "not started yet — this is not a gap in the data"
                    : c.note}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Invariant failures mean the output above is suspect. Silence here is the expected case;
          anything listed is a shape of error this project has shipped before. */}
      {violations.length > 0 && (
        <div className="mt-4 rounded-lg border border-[var(--color-accent)] px-4 py-3">
          <p className="text-sm font-medium text-[var(--color-accent)]">
            {violations.length} data check{violations.length === 1 ? "" : "s"} failed — treat the
            timeline above as unreliable
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-[var(--color-muted)]">
            {violations.slice(0, 6).map((v, i) => (
              <li key={i}>
                <span className="font-mono">{v.rule}</span> — {v.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Slow is the design, not a fault: archive.org throttles by IP, so every worker shares one
          global budget and crawls wait for each other rather than getting each other blocked. */}
      {pending > 0 && (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Archive sources are deliberately rate-limited to one request every two seconds, shared
          across every crawl. A full run takes a couple of minutes.
        </p>
      )}
    </section>
  );
}
