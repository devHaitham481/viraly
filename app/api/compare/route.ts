import { NextResponse } from "next/server";
import { compareTargets } from "@/lib/compare";

export async function GET(req: Request) {
  const ids = new URL(req.url).searchParams.getAll("id").filter((s) => /^\d+$/.test(s));
  if (!ids.length) return NextResponse.json({ comparisons: [] });
  return NextResponse.json({ comparisons: await compareTargets(ids.slice(0, 5)) });
}
