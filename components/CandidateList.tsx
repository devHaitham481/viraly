import type { Candidate } from "@/lib/schema";

/**
 * The disambiguation step (DECISIONS.md D3).
 *
 * Shown even when there is only one result. Confirming one candidate costs a click; a silent
 * auto-pick costs an entire timeline about the wrong product — and the App Store really does hold
 * two unrelated apps called "HabitKit".
 */
export function CandidateList({
  candidates,
  onPick,
}: {
  candidates: Candidate[];
  onPick: (c: Candidate) => void;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium text-[var(--color-muted)]">
        Which one? <span className="font-normal">({candidates.length} found)</span>
      </h2>

      <ul className="mt-3 divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)] bg-white">
        {candidates.map((c) => (
          <li key={c.ios_id}>
            <button
              onClick={() => onPick(c)}
              className="flex w-full items-center gap-4 p-4 text-left hover:bg-[var(--color-paper)]"
            >
              {c.artwork ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.artwork} alt="" className="size-12 shrink-0 rounded-xl" />
              ) : (
                <div className="size-12 shrink-0 rounded-xl bg-[var(--color-line)]" />
              )}

              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.name}</div>
                <div className="truncate text-sm text-[var(--color-muted)]">
                  {c.developer}
                  {c.domain && <> · {c.domain}</>}
                </div>
              </div>

              <div className="shrink-0 text-right text-sm text-[var(--color-muted)] tabular-nums">
                <div>{c.released ? c.released.slice(0, 7) : "—"}</div>
                <div>
                  {c.rating_count.toLocaleString("en-US")}★
                  {c.rating_avg !== null && c.rating_count > 0 && (
                    <> · {c.rating_avg.toFixed(2)}</>
                  )}
                </div>
              </div>
            </button>
          </li>
        ))}

        <li className="p-4 text-sm text-[var(--color-muted)]">
          None of these? Searching by domain comes at E6 — for now, refine the name.
        </li>
      </ul>
    </section>
  );
}
