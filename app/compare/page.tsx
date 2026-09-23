"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgeChart, type Series } from "@/components/AgeChart";
import type { Insights } from "@/lib/insights";

interface Target {
  ios_id: string;
  name: string;
  artwork: string | null;
  events: number;
}

interface Comparison {
  ios_id: string;
  name: string;
  insights: Insights;
}

const fmtDays = (d: number | null) =>
  d === null ? "—" : d < 90 ? `${d}d` : `${Math.round(d / 30.44)}mo`;

/** Never print a duration we cannot observe — see lib/insights.ts. */
function milestone(i: Insights, n: number): string {
  const m = i.milestones.find((x) => x.ratings === n);
  if (!m) return "—";
  if (m.already_passed) {
    return m.days_upper_bound !== undefined && m.days_upper_bound <= 180
      ? `<${fmtDays(m.days_upper_bound)}`
      : "before our data";
  }
  if (m.days !== null) return fmtDays(m.days);
  if (m.days_min !== null && m.days_max !== null) {
    return `${fmtDays(m.days_min)}–${fmtDays(m.days_max)}`;
  }
  return "—";
}

const ROWS: { label: string; of: (i: Insights) => string }[] = [
  {
    // Apps are compared on the same row, so the label must not claim "year 1" for a reading that
    // landed at month 4 for one of them.
    label: "Ratings near year 1",
    of: (i) =>
      i.year_one ? `${i.year_one.value.toLocaleString("en-US")} (day ${i.year_one.day})` : "—",
  },
  { label: "To 100 ratings", of: (i) => milestone(i, 100) },
  { label: "To 1,000 ratings", of: (i) => milestone(i, 1000) },
  { label: "Public before launch", of: (i) => fmtDays(i.pre_launch_days) },
  { label: "Feature releases", of: (i) => String(i.feature_releases) },
  { label: "Median ship gap", of: (i) => (i.median_days_between_releases ? `${i.median_days_between_releases}d` : "—") },
  { label: "Growth acceleration", of: (i) => (i.growth_multiple ? `${i.growth_multiple.toFixed(1)}×` : "—") },
  { label: "Repositionings", of: (i) => String(i.repositionings) },
  { label: "Blog posts", of: (i) => String(i.content_posts) },
];

export default function Compare() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [rows, setRows] = useState<Comparison[]>([]);

  useEffect(() => {
    fetch("/api/targets")
      .then((r) => r.json())
      .then((d) => {
        setTargets(d.targets ?? []);
        setPicked((d.targets ?? []).slice(0, 2).map((t: Target) => t.ios_id));
      });
  }, []);

  useEffect(() => {
    if (!picked.length) return void setRows([]);
    const q = picked.map((id) => `id=${id}`).join("&");
    fetch(`/api/compare?${q}`)
      .then((r) => r.json())
      .then((d) => setRows(d.comparisons ?? []));
  }, [picked]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-5)));

  const series: Series[] = rows.map((r) => ({ name: r.name, insights: r.insights }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compare</h1>
          <p className="mt-1 text-[var(--color-muted)]">
            Aligned at each app&rsquo;s own launch — here is you at month 7, here is them at month 7.
          </p>
        </div>
        <Link href="/" className="text-sm underline decoration-[var(--color-line)] underline-offset-4">
          new search
        </Link>
      </header>

      {targets.length === 0 ? (
        <p className="mt-10 text-[var(--color-muted)]">
          Nothing crawled yet. <Link href="/" className="underline">Search for an app</Link> first —
          only finished crawls can be compared.
        </p>
      ) : (
        <>
          <div className="mt-8 flex flex-wrap gap-2">
            {targets.map((t) => (
              <button
                key={t.ios_id}
                onClick={() => toggle(t.ios_id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  picked.includes(t.ios_id)
                    ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]"
                    : "border-[var(--color-line)] bg-white"
                }`}
              >
                {t.name.length > 28 ? `${t.name.slice(0, 28)}…` : t.name}
                <span className="ml-1.5 opacity-60">{t.events}</span>
              </button>
            ))}
          </div>

          {series.length > 0 && (
            <section className="mt-10">
              <AgeChart series={series} />
            </section>
          )}

          {rows.length > 0 && (
            <section className="mt-10 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-line)]">
                    <th className="py-2 text-left font-medium text-[var(--color-muted)]">&nbsp;</th>
                    {rows.map((r) => (
                      <th key={r.ios_id} className="py-2 text-right font-medium">
                        {r.name.length > 20 ? `${r.name.slice(0, 20)}…` : r.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {ROWS.map((row) => (
                    <tr key={row.label}>
                      <td className="py-2 text-[var(--color-muted)]">{row.label}</td>
                      {rows.map((r) => (
                        <td key={r.ios_id} className="py-2 text-right tabular-nums">
                          {row.of(r.insights)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {rows.length > 0 && rows.length < picked.length && (
            <p className="mt-4 text-xs text-[var(--color-muted)]">
              Some selected apps have no launch date or growth series yet and cannot be placed on a
              shared axis.
            </p>
          )}
        </>
      )}
    </main>
  );
}
