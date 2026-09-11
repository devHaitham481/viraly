import type { Coverage } from "@/lib/schema";

const TONE: Record<Coverage["status"], string> = {
  ok: "text-emerald-700",
  partial: "text-amber-700",
  empty: "text-[var(--color-muted)]",
  failed: "text-[var(--color-accent)]",
};

/**
 * What was actually looked at.
 *
 * Not bookkeeping: a chronological timeline makes absence look like fact, and this is the only thing
 * separating "they went quiet" from "the crawler failed" (PRD §5).
 */
export function CoverageReport({ coverage }: { coverage: Coverage[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium text-[var(--color-muted)]">Coverage</h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        What was queried, and what it returned. A gap in the timeline above means nothing unless the
        source below says <span className="font-medium">ok</span>.
      </p>
      <table className="mt-3 w-full text-sm">
        <tbody className="divide-y divide-[var(--color-line)]">
          {coverage.map((c) => (
            <tr key={c.source}>
              <td className="py-2 pr-4 font-medium">{c.source}</td>
              <td className={`py-2 pr-4 ${TONE[c.status]}`}>{c.status}</td>
              <td className="py-2 text-[var(--color-muted)]">{c.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
