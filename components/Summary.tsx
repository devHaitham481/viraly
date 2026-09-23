import type { Brief } from "@/lib/brief";

/**
 * The summary panel.
 *
 * This is the first thing a reader should see, because it is the only part that states what the
 * crawl *means*. Everything below it is the evidence.
 *
 * The caveat is not fine print and is not styled as such. Most steps in a typical timeline have no
 * measurable effect, and a reader who takes the paragraphs above as causal has misread the page —
 * so the limits sit in the same visual weight as the findings.
 */
export function Summary({ brief, name }: { brief: Brief; name: string }) {
  if (brief.paragraphs.length === 0 && !brief.caveat) return null;

  return (
    <section className="mt-10 rounded-xl border border-[var(--color-line)] bg-white p-6">
      <h2 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
        How {name} grew
      </h2>

      <p className="mt-2 text-xl font-semibold leading-snug tracking-tight text-balance">
        {brief.headline}
      </p>

      {brief.paragraphs.length > 0 && (
        <div className="mt-4 space-y-2.5 text-[15px] leading-relaxed">
          {brief.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      <p className="mt-5 border-t border-[var(--color-line)] pt-4 text-sm text-[var(--color-muted)]">
        <span className="font-medium text-[var(--color-ink)]">What this cannot tell you. </span>
        {brief.caveat}
      </p>
    </section>
  );
}
