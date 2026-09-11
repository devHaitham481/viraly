/** Shared test setup. The frozen clock is what keeps golden output stable across days. */
import { loadManifest, replayCtx, type Ctx } from "../lib/fetcher.ts";

/** Any fixed instant. Chosen once; changing it invalidates every golden file. */
export const FROZEN_NOW = "2026-09-11T00:00:00.000Z";

/** The targets with committed golden output. */
export const GOLDEN = {
  habitkit: "6443918070",
  impostor: "6761298880",
} as const;

export async function offlineCtx(): Promise<Ctx> {
  return replayCtx(await loadManifest(), FROZEN_NOW);
}
