import { NextResponse } from "next/server";
import { searchApps } from "@/lib/sources/itunes";
import { liveCtx } from "@/lib/fetcher";

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
    return NextResponse.json({ candidates: await searchApps(query, liveCtx()) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 502 },
    );
  }
}
