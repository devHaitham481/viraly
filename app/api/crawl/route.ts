import { NextResponse } from "next/server";
import { createCrawl } from "@/lib/crawl";

/**
 * Start a crawl. Returns immediately with an id — iTunes resolves synchronously, everything else is
 * queued for the worker, and the client polls `/api/crawl/[id]` as results land.
 */
export async function POST(req: Request) {
  let ios_id = "";
  try {
    ({ ios_id } = await req.json());
  } catch {
    return NextResponse.json({ error: "malformed body" }, { status: 400 });
  }
  if (typeof ios_id !== "string" || !/^\d+$/.test(ios_id)) {
    return NextResponse.json({ error: "ios_id must be numeric" }, { status: 400 });
  }

  try {
    return NextResponse.json({ crawl_id: await createCrawl(ios_id) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "crawl failed" },
      { status: 502 },
    );
  }
}
