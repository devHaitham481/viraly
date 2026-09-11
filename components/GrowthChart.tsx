import type { Event, Metric } from "@/lib/schema";

/**
 * The growth curve, with events marked on it.
 *
 * This is the artifact the whole product is for: a timeline alone says what happened, and a curve
 * alone says how fast it grew, but only the two together let you ask whether any of it mattered.
 *
 * Inline SVG, no chart library — one series and a set of ticks does not earn a dependency.
 */
export function GrowthChart({ metrics, events }: { metrics: Metric[]; events: Event[] }) {
  const points = metrics
    .filter((m) => m.metric === "ios_rating_count" && typeof m.value === "number")
    .map((m) => ({ t: Date.parse(m.date), v: m.value as number }))
    .sort((a, b) => a.t - b.t);

  // One live reading is not a series — a two-point line implies a trend we did not measure.
  if (points.length < 3) return null;

  const W = 680;
  const H = 180;
  const PAD = { top: 12, right: 8, bottom: 22, left: 8 };

  const t0 = points[0].t;
  const t1 = points.at(-1)!.t;
  const vMax = Math.max(...points.map((p) => p.v));

  const x = (t: number) =>
    PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number) => H - PAD.bottom - (v / vMax) * (H - PAD.top - PAD.bottom);

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(t1).toFixed(1)},${H - PAD.bottom} L${x(t0).toFixed(1)},${H - PAD.bottom} Z`;

  /**
   * Segments spanning a long gap between readings are drawn dashed.
   *
   * Archived captures are sparse, and a solid line across a 282-day hole invites a reader to read a
   * value off a month nobody ever measured — the same false precision that made "457 days to 100
   * ratings" out of the far edge of that hole.
   */
  const GAP_DAYS = 120;
  const segments = points.slice(1).map((p, i) => ({
    d: `M${x(points[i].t).toFixed(1)},${y(points[i].v).toFixed(1)} L${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`,
    interpolated: (p.t - points[i].t) / 86_400_000 > GAP_DAYS,
  }));
  const gaps = segments.filter((s) => s.interpolated).length;

  const marks = events
    .map((e) => ({ ...e, t: Date.parse(e.date) }))
    .filter((e) => !Number.isNaN(e.t) && e.t >= t0 && e.t <= t1);

  const fmt = (t: number) =>
    new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric" });

  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Ratings grew from ${points[0].v} to ${points.at(-1)!.v} between ${fmt(t0)} and ${fmt(t1)}`}
      >
        <path d={area} fill="var(--color-accent)" opacity="0.08" />
        {segments.map((s, i) => (
          <path
            key={i}
            d={s.d}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="1.75"
            strokeDasharray={s.interpolated ? "3 4" : undefined}
            opacity={s.interpolated ? 0.5 : 1}
          />
        ))}
        {points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r="1.8" fill="var(--color-accent)" />
        ))}

        {marks.map((e, i) => (
          <g key={i}>
            <line
              x1={x(e.t)}
              x2={x(e.t)}
              y1={PAD.top - 4}
              y2={H - PAD.bottom}
              stroke={e.by_founder ? "var(--color-ink)" : "var(--color-line)"}
              strokeWidth="1"
              strokeDasharray={e.date_exact ? undefined : "2 3"}
              opacity={e.by_founder ? 0.45 : 0.8}
            />
            <circle cx={x(e.t)} cy={PAD.top - 4} r="2.5" fill={e.by_founder ? "var(--color-ink)" : "var(--color-line)"}>
              <title>{`${e.date} · ${e.title}`}</title>
            </circle>
          </g>
        ))}

        <text x={PAD.left} y={H - 6} fontSize="11" fill="var(--color-muted)">
          {fmt(t0)}
        </text>
        <text x={W - PAD.right} y={H - 6} fontSize="11" textAnchor="end" fill="var(--color-muted)">
          {fmt(t1)}
        </text>
        <text x={W - PAD.right} y={PAD.top + 4} fontSize="11" textAnchor="end" fill="var(--color-muted)">
          {vMax.toLocaleString()} ratings
        </text>
      </svg>

      <figcaption className="mt-1 text-xs text-[var(--color-muted)]">
        iOS ratings over time, from archived App Store listings · {points.length} dated points ·
        ticks are events, dashed where the date is approximate
        {gaps > 0 && (
          <> · {gaps} dashed segment{gaps === 1 ? "" : "s"} span months with no reading — the line
          there is drawn, not measured</>
        )}
      </figcaption>
    </figure>
  );
}
