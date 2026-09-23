import { Crawler } from "@/components/Crawler";
import { Timeline } from "@/components/Timeline";
import { CoverageReport } from "@/components/CoverageReport";
import { GrowthChart } from "@/components/GrowthChart";
import { InsightsPanel } from "@/components/Insights";
import { Summary } from "@/components/Summary";
import { DEMO } from "@/lib/demo";
import type { SourceId } from "@/lib/schema";

/**
 * The landing page.
 *
 * A server component, so the worked example below the fold is real output computed at build time
 * from a recorded crawl — no database, no worker, no fetch. The page is therefore always up and
 * always populated, which matters because a growth-forensics tool that greets you with an empty
 * search box is asking you to imagine the product.
 *
 * Only the search box is interactive, and it is the one thing that ships as client JS.
 */

/** What each source is for, in a sentence. Paired at render with what it actually returned. */
const SOURCES: { id: SourceId; label: string; what: string }[] = [
  { id: "itunes", label: "iTunes", what: "Identity. The store id everything else keys off — two unrelated apps are called HabitKit." },
  { id: "rdap", label: "RDAP", what: "Domain registration: the earliest public trace of a project, usually predating everything else." },
  { id: "wayback", label: "Wayback", what: "Landing-page copy across every archived capture. Every repositioning, dated." },
  { id: "structure", label: "Site structure", what: "What they built and when — a press kit, a pricing page, a changelog — and what they quietly took down." },
  { id: "appstore", label: "App Store", what: "Archived listings: the rating series, release notes, and every price change." },
  { id: "playstore", label: "Google Play", what: "Install brackets — the closest thing to a public download count — and a second review series." },
  { id: "blog", label: "Blog", what: "Their own posts, dated from the sitemap. Where a content play started, and whether it stopped." },
  { id: "podcast", label: "Podcasts", what: "Guest appearances, filtered to real mentions rather than name collisions." },
  { id: "github", label: "GitHub", what: "The founder's public repos, once a handle resolves." },
  { id: "hackernews", label: "Hacker News", what: "Domain-anchored, not name-anchored: “habitkit” returns 12,135 hits, the domain returns 1." },
];

const DELIVERS = [
  {
    title: "A chronological timeline",
    body: "Every dated move from the first public trace to today, grouped into steps — two events three days apart are one measurement, not two.",
  },
  {
    title: "What each step did",
    body: "The growth reading either side of it. Where a change is measurable it says so; where it is not, it says that instead of guessing.",
  },
  {
    title: "Benchmarks",
    body: "Ratings at year one, time to the first thousand, shipping cadence, price moves. The numbers teardowns leave out because the story reads better without them.",
  },
  {
    title: "A coverage report",
    body: "Which sources answered, which failed, and which had nothing. A gap in the timeline must never look like a gap in the crawl.",
  },
];

export default function Home() {
  const { app, brief, steps, insights, events, metrics, coverage, span, recorded_at } = DEMO;

  const bySource = new Map<string, number>();
  for (const e of events) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);

  const stats = [
    { value: String(events.length), label: "dated events" },
    { value: String(metrics.length), label: "growth readings" },
    { value: `${DEMO.sources_ok}/${coverage.length}`, label: "sources answered" },
    { value: "0", label: "invented values" },
  ];

  return (
    <main>
      {/* ---- nav ------------------------------------------------------------ */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">viraly</span>
        <div className="flex items-center gap-5 text-sm">
          <a href="#example" className="text-[var(--color-muted)] transition hover:text-[var(--color-ink)]">
            Example
          </a>
          <a href="#sources" className="text-[var(--color-muted)] transition hover:text-[var(--color-ink)]">
            Sources
          </a>
          <a
            href="/compare"
            className="rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 transition hover:border-[var(--color-ink)]"
          >
            Compare
          </a>
        </div>
      </nav>

      {/* ---- hero ----------------------------------------------------------- */}
      <section className="relative overflow-hidden border-b border-[var(--color-line)] pb-20 pt-14">
        {/* A warm wash behind the fold. Decorative only, and never over the text. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(184,83,42,0.10),transparent_70%)]"
        />

        <div className="relative mx-auto max-w-6xl px-6 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs text-[var(--color-muted)]">
            <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
            {coverage.length} public sources · no LLM in the pipeline
          </span>

          <h1 className="mx-auto mt-6 max-w-4xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            How this app actually grew, with dates
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg leading-relaxed text-[var(--color-muted)]">
            Enter a name. viraly reconstructs a chronological, evidence-backed timeline from public
            archives — every launch, price change, post and repositioning — and says what each one
            did to the growth curve.
          </p>

          <div className="mt-9">
            <Crawler>
              <>
                {/* ---- stat strip ------------------------------------------- */}
                <div className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-4">
                  {stats.map((s) => (
                    <div key={s.label} className="bg-[var(--color-paper)] px-4 py-5">
                      <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
                      <div className="mt-0.5 text-xs text-[var(--color-muted)]">{s.label}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-[var(--color-muted)]">
                  From the example below — one real crawl, not a running total.
                </p>
              </>
            </Crawler>
          </div>
        </div>
      </section>

      {/* ---- the worked example -------------------------------------------- */}
      <section id="example" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            A real crawl, start to finish
          </h2>
          <p className="mt-3 text-[var(--color-muted)]">
            Everything below is output, not illustration — {app.name} reconstructed from{" "}
            {DEMO.sources_ok} sources, {span.from} to {span.to}. Every row links to the page it came
            from.
          </p>
        </div>

        {/* Framed, so it reads as the product's output rather than as more page copy. */}
        <div className="mt-8 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-white shadow-sm [--surface:#fff]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-paper)] px-5 py-3">
            <div className="flex items-center gap-2.5">
              <span className="size-2 rounded-full bg-[var(--color-accent)]" />
              <span className="font-medium">{app.name}</span>
              <span className="text-sm text-[var(--color-muted)]">{app.domain}</span>
            </div>
            <span className="font-mono text-xs text-[var(--color-muted)]">
              recorded {recorded_at}
            </span>
          </div>

          <div className="px-2.5 pb-8 pt-1 sm:px-8">
            <Summary brief={brief} name={app.name} />

            <section className="mt-10">
              <h3 className="text-sm font-medium text-[var(--color-muted)]">Timeline</h3>
              <p className="mt-1 text-sm text-[var(--color-muted)]">{DEMO.attribution}</p>
              <Timeline steps={steps} />
            </section>

            <section className="mt-10">
              <h3 className="text-sm font-medium text-[var(--color-muted)]">Growth</h3>
              <GrowthChart metrics={metrics} events={events} />
            </section>

            <InsightsPanel insights={insights} name={app.name} />

            <CoverageReport coverage={coverage} />
          </div>
        </div>
      </section>

      {/* ---- what comes back ------------------------------------------------ */}
      <section className="border-y border-[var(--color-line)] bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            What comes back
          </h2>
          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {DELIVERS.map((d, i) => (
              <div key={d.title} className="border-t border-[var(--color-line)] pt-5">
                <span className="font-mono text-xs text-[var(--color-muted)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 font-medium">{d.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- sources -------------------------------------------------------- */}
      <section id="sources" className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Where the record comes from
          </h2>
          <p className="mt-3 text-[var(--color-muted)]">
            Every source is deterministic — archives, store listings, sitemaps, registries. No model
            decides what is true, which is what makes the output testable and a timeline
            reproducible.
          </p>
        </div>

        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2">
          {SOURCES.map((s) => {
            const n = bySource.get(s.id) ?? 0;
            return (
              <div key={s.id} className="bg-[var(--color-paper)] px-5 py-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-medium">{s.label}</h3>
                  <span className="shrink-0 font-mono text-xs text-[var(--color-muted)]">
                    {n > 0 ? `${n} event${n === 1 ? "" : "s"}` : "—"}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{s.what}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- the honest part ------------------------------------------------ */}
      <section className="border-t border-[var(--color-line)] bg-[var(--color-ink)] text-[var(--color-paper)]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-10 md:grid-cols-[1fr_1.1fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                It tells you what it cannot tell you
              </h2>
              <p className="mt-4 leading-relaxed text-[var(--color-paper)]/70">
                Archived readings land roughly every two months, so most steps have no measurement
                close enough on either side to judge. Saying so is the feature. A confident number
                derived from data that cannot support it is the failure this whole project is built
                against.
              </p>
            </div>

            <figure className="rounded-xl border border-[var(--color-paper)]/15 bg-[var(--color-paper)]/5 p-6">
              <figcaption className="text-xs uppercase tracking-wide text-[var(--color-paper)]/50">
                From the {app.name} crawl above
              </figcaption>
              <blockquote className="mt-3 leading-relaxed">“{brief.caveat}”</blockquote>
            </figure>
          </div>
        </div>
      </section>

      {/* ---- footer --------------------------------------------------------- */}
      <footer className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-line)] pt-8 text-sm text-[var(--color-muted)]">
          <span>viraly — reconstruct how an app grew, from public sources.</span>
          <div className="flex gap-5">
            <a href="/compare" className="transition hover:text-[var(--color-ink)]">
              Compare
            </a>
            <a
              href="https://github.com/devHaitham481/viraly"
              className="transition hover:text-[var(--color-ink)]"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
