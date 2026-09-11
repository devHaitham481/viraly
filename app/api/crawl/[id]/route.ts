import { NextResponse } from "next/server";
import { readCrawl } from "@/lib/crawl";

/** Poll a crawl. Returns everything known so far, plus how many sources are still outstanding. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Postgres rejects a non-UUID with a type error, which would surface as a 500 rather than the 404
  // this route intends.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "no such crawl" }, { status: 404 });
  }
  const crawl = await readCrawl(id);
  if (!crawl) return NextResponse.json({ error: "no such crawl" }, { status: 404 });
  return NextResponse.json(crawl);
}
