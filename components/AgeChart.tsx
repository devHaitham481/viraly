import type { Insights } from "@/lib/insights";

export interface Series {
  name: string;
  insights: Insights;
}

/** Distinct without being decorative. Order is stable so a line keeps its colour across renders. */
const COLORS = ["var(--color-accent)", "#2f6f5e", "#4a5aa8", "#8a6d1f", "#7a3f6d"];

/**
 * Growth by age, not by date.
 *
 * A calendar x-axis compares an app launched in 2019 against one launched last year and answers
 * nothing. Months-since-launch puts every app at the same starting line, which is the only framing
 * that answers "am I ahead or behind?".
 *
 * Log scale, because early growth is the interesting part: on a linear axis an app at 2,400 ratings
 * flattens everything below it into the baseline, and the first year — where the reader actually
 * lives — becomes unreadable.
 */
export function AgeChart({ series }: { series: Series[] }) {
  const usable = series.filter((s) => s.insights.age_series.length >= 2);
  if (!usable.length) return null;

  const W = 700;
  const H = 260;
  const PAD = { top: 14, right: 14, bottom: 30, left: 44 };

  const maxMonth = Math.max(...usable.flatMap((s) => s.insights.age_series.map((p) => p.month)), 6);
  const maxVal = Math.max(...usable.flatMap((s) => s.insights.age_series.map((p) => p.value)), 10);

  const logMax = Math.log10(maxVal);
  const x = (m: number) => PAD.left + (m / maxMonth) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    H - PAD.bottom - (Math.log10(Math.max(1, v)) / logMax) * (H - PAD.top - PAD.bottom);

  const ticks = [1, 10, 100, 1_000, 10_000, 100_000].filter((t) => t <= maxVal * 1.2);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
           aria-label={`Ratings by months since launch for ${usable.map((s) => s.name).join(", ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
                  stroke="var(--color-line)" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(t) + 3} fontSize="10" textAnchor="end" fill="var(--color-muted)">
              {t >= 1000 ? `${t / 1000}k` : t}
            </text>
          </g>
        ))}

        {usable.map((s, si) => {
          const pts = s.insights.age_series;
          const colour = COLORS[si % COLORS.length];
          // A reader is invited to compare "you at month 7" against a line that may be interpolated
          // across a year of missing captures. Dash those stretches.
          const GAP_MONTHS = 4;
          return (
            <g key={s.name}>
              {pts.slice(1).map((p, i) => (
                <path
                  key={i}
                  d={`M${x(pts[i].month).toFixed(1)},${y(pts[i].value).toFixed(1)} L${x(p.month).toFixed(1)},${y(p.value).toFixed(1)}`}
                  fill="none"
                  stroke={colour}
                  strokeWidth="2"
                  strokeDasharray={p.month - pts[i].month > GAP_MONTHS ? "3 4" : undefined}
                  opacity={p.month - pts[i].month > GAP_MONTHS ? 0.5 : 1}
                />
              ))}
              {pts.map((p, i) => <circle key={i} cx={x(p.month)} cy={y(p.value)} r="1.8" fill={colour} />)}
              <circle cx={x(pts.at(-1)!.month)} cy={y(pts.at(-1)!.value)} r="3" fill={colour} />
            </g>
          );
        })}

        {[0, Math.round(maxMonth / 2), maxMonth].map((m) => (
          <text key={m} x={x(m)} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--color-muted)">
            {m === 0 ? "launch" : `${m}mo`}
          </text>
        ))}
      </svg>

      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {usable.map((s, si) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: COLORS[si % COLORS.length] }} />
            {s.name}
          </span>
        ))}
        <span className="text-[var(--color-muted)]">
          · iOS ratings, log scale, aligned at each app&rsquo;s own launch · dots are real readings;
          dashed stretches are interpolated across months with no capture
        </span>
      </figcaption>
    </figure>
  );
}
