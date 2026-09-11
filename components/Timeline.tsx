import type { TimelineEntry, Verdict } from "@/lib/impact";

/** An inexact date is drawn differently — a bracket, never a point. */
function DateCell({ date, exact }: { date: string; exact: boolean }) {
  return (
    <time
      className={`w-24 shrink-0 tabular-nums text-sm ${
        exact ? "text-[var(--color-ink)]" : "text-[var(--color-muted)] italic"
      }`}
      title={exact ? "exact date" : "approximate — inferred, not stated"}
    >
      {exact ? date : `~${date}`}
    </time>
  );
}

const VERDICT_LABEL: Record<Verdict, string> = {
  accelerated: "growth picked up after this",
  slowed: "growth slowed after this",
  steady: "no change in growth",
  unknown: "",
};

const VERDICT_TONE: Record<Verdict, string> = {
  accelerated: "text-emerald-700",
  slowed: "text-[var(--color-accent)]",
  steady: "text-[var(--color-muted)]",
  unknown: "text-[var(--color-muted)]",
};

const rate = (v: number | null) => (v === null ? "—" : `${Math.round(v)}/mo`);

/**
 * What they did, where they were when they did it, and whether it moved anything.
 *
 * The third column is blank far more often than not: archived captures land roughly every two
 * months, so most events have no reading close enough on either side to compare. Showing the reason
 * rather than a guess is the point.
 */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="mt-3 text-sm text-[var(--color-muted)]">
        No events. Check the coverage report below — this may mean nothing happened, or that nothing
        was successfully looked at.
      </p>
    );
  }

  return (
    <ol className="mt-3 border-l border-[var(--color-line)]">
      {entries.map((e, i) => (
        <li key={`${e.date}-${i}`} className="relative flex gap-4 py-3 pl-6">
          <span
            className={`absolute -left-[4.5px] top-5 size-2 rounded-full ${
              e.by_founder ? "bg-[var(--color-accent)]" : "bg-[var(--color-line)]"
            }`}
            title={e.by_founder ? "the product's own move" : "someone else"}
          />
          <DateCell date={e.date} exact={e.date_exact} />

          <div className="min-w-0 flex-1">
            <a
              href={e.url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-[var(--color-line)] underline-offset-4 hover:decoration-[var(--color-ink)]"
            >
              {e.title}
            </a>

            <div className="mt-0.5 text-sm text-[var(--color-muted)]">
              {e.kind} · {e.source}
              {e.by && <> · {e.by}</>}
              {e.number !== null && <> · {e.number.toLocaleString()}</>}
              {e.impact.ratings_at !== null && (
                <> · at {e.impact.ratings_at.toLocaleString()} ratings</>
              )}
            </div>

            {e.impact.verdict !== "unknown" ? (
              <div className={`mt-1 text-sm ${VERDICT_TONE[e.impact.verdict]}`}>
                {VERDICT_LABEL[e.impact.verdict]} — {rate(e.impact.velocity_before)} →{" "}
                {rate(e.impact.velocity_after)}
              </div>
            ) : (
              e.impact.reason && (
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  effect not measurable — {e.impact.reason}
                </div>
              )
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
