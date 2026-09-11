import { NextResponse } from "next/server";
import { listTargets } from "@/lib/compare";

/** Targets with a finished crawl — the only ones that can be compared. */
export async function GET() {
  return NextResponse.json({ targets: await listTargets() });
}
