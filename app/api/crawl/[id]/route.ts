import { NextResponse } from "next/server";
import { readCrawl } from "@/lib/crawl";

/** Poll a crawl. Returns everything known so far, plus how many sources are still outstanding. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const crawl = await readCrawl(id);
  if (!crawl) return NextResponse.json({ error: "no such crawl" }, { status: 404 });
  return NextResponse.json(crawl);
}
