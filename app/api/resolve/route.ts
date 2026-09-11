import { NextResponse } from "next/server";
import { searchApps } from "@/lib/sources/itunes";
import { liveCtx } from "@/lib/fetcher";
import { acquire } from "@/lib/queue/limiter";

/** Step 1 of resolution: a name → candidates. Server-side to keep the upstream call off the browser. */
export async function POST(req: Request) {
  let query = "";
  try {
    ({ query } = await req.json());
  } catch {
    return NextResponse.json({ error: "malformed body" }, { status: 400 });
  }

  if (typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ candidates: [] });
  }

  try {
    return NextResponse.json({ candidates: // Must go through the global bucket: this is the one endpoint a user can hammer from a form.
      await searchApps(query, liveCtx({ acquire })) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 502 },
    );
  }
}
