import type { Event } from "@/lib/schema";

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

export function Timeline({ events }: { events: Event[] }) {
  if (events.length === 0) {
    return (
      <p className="mt-3 text-sm text-[var(--color-muted)]">
        No events. Check the coverage report below — this may mean nothing happened, or that nothing
        was successfully looked at.
      </p>
    );
  }

  return (
    <ol className="mt-3 border-l border-[var(--color-line)]">
      {events.map((e, i) => (
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
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
