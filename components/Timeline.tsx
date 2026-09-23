import type { Step, Verdict } from "@/lib/impact";
import type { Event } from "@/lib/schema";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return { day: `${Number(d)} ${MONTHS[Number(m) - 1]}`, year: y };
}

const VERDICT: Record<Verdict, { label: string; tone: string; dot: string }> = {
  accelerated: { label: "Growth picked up", tone: "text-emerald-700", dot: "bg-emerald-600" },
  slowed: { label: "Growth slowed", tone: "text-[var(--color-accent)]", dot: "bg-[var(--color-accent)]" },
  steady: { label: "No change in growth", tone: "text-[var(--color-muted)]", dot: "bg-[var(--color-line)]" },
  unknown: { label: "", tone: "", dot: "" },
};

/** Sources whose events are things the product did, rather than things done to it. */
const rate = (v: number | null) => (v === null ? "—" : `${Math.round(v)}/mo`);

function Action({ event }: { event: Event }) {
  return (
    <li className="flex gap-2.5">
      <span
        className={`mt-[7px] size-1.5 shrink-0 rounded-full ${
          event.by_founder ? "bg-[var(--color-accent)]" : "bg-[var(--color-line)]"
        }`}
        title={event.by_founder ? "their own move" : "someone else"}
      />
      <div className="min-w-0">
        <a
          href={event.url}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-[var(--color-line)] underline-offset-4 hover:decoration-[var(--color-ink)]"
        >
          {event.title}
        </a>
        <div className="text-xs text-[var(--color-muted)]">
          {event.kind.replace(/_/g, " ")} · {event.source}
          {event.by && <> · {event.by}</>}
          {event.number !== null && <> · {event.number.toLocaleString("en-US")}</>}
        </div>
      </div>
    </li>
  );
}

/**
 * The effect column.
 *
 * It never goes blank. Where a change is measurable it says so; where it is not — the common case,
 * because archived captures land roughly every two months — it still states *where they were*, which
 * is the context that makes a step legible. An empty cell would read as "nothing happened".
 */
function Effect({ step }: { step: Step }) {
  const { impact } = step;
  const v = VERDICT[impact.verdict];

  return (
    <div className="md:text-right">
      {impact.ratings_at !== null && (
        <div className="tabular-nums">
          <span className="text-lg font-medium">{impact.ratings_at.toLocaleString("en-US")}</span>
          <span className="ml-1 text-xs text-[var(--color-muted)]">ratings</span>
        </div>
      )}

      {impact.verdict !== "unknown" ? (
        <div className={`mt-1 text-sm ${v.tone}`}>
          <span className="inline-flex items-center gap-1.5 md:flex-row-reverse">
            <span className={`size-1.5 rounded-full ${v.dot}`} />
            {v.label}
          </span>
          <div className="text-xs tabular-nums text-[var(--color-muted)]">
            {rate(impact.velocity_before)} → {rate(impact.velocity_after)}
          </div>
        </div>
      ) : (
        <div className="mt-1 text-xs text-[var(--color-muted)]">
          {impact.reason === "no growth data" ? "no growth data" : "effect not measurable"}
        </div>
      )}
    </div>
  );
}

/**
 * A chronological two-column timeline: what they did, and what it did to growth.
 *
 * Events are grouped into steps first (`buildSteps`). Two events three days apart share an identical
 * before/after window, so listing them separately shows one measurement twice and reads as two
 * independent confirmations.
 */
export function Timeline({ steps }: { steps: Step[] }) {
  if (steps.length === 0) {
    return (
      <p className="mt-3 text-sm text-[var(--color-muted)]">
        No events. Check the coverage report below — this may mean nothing happened, or that nothing
        was successfully looked at.
      </p>
    );
  }

  let lastYear = "";

  return (
    <div className="mt-4">
      <div className="hidden border-b border-[var(--color-line)] pb-2 text-xs uppercase tracking-wide text-[var(--color-muted)] md:grid md:grid-cols-[5.5rem_1fr_11rem] md:gap-6">
        <span>When</span>
        <span>What they did</span>
        <span className="text-right">What it did to growth</span>
      </div>

      <ol>
        {steps.map((step, i) => {
          const { day, year } = shortDate(step.date);
          const newYear = year !== lastYear;
          lastYear = year;

          return (
            <li key={`${step.date}-${i}`}>
              {newYear && (
                <div className="sticky top-0 z-10 -mx-2 bg-[var(--surface)]/95 px-2 pb-1 pt-4 text-sm font-medium backdrop-blur">
                  {year}
                </div>
              )}

              <div className="grid gap-1.5 border-b border-[var(--color-line)] py-4 md:grid-cols-[5.5rem_1fr_11rem] md:gap-6">
                <div
                  className="shrink-0 text-sm tabular-nums text-[var(--color-muted)]"
                  title={step.approximate ? "approximate — inferred, not stated" : "exact date"}
                >
                  {step.approximate && <span aria-hidden>~</span>}
                  {day}
                </div>

                <ul className="space-y-2 text-sm">
                  {step.events.map((e, n) => (
                    <Action key={n} event={e} />
                  ))}
                </ul>

                <Effect step={step} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
