import postgres from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The docker-compose service — a development convenience that must not survive into production.
 *
 * Deployed with no `DATABASE_URL`, this default sends every API route to dial a machine that is not
 * there: the request spends its timeout and comes back `ECONNREFUSED`, which reads as a broken
 * database rather than an unconfigured one. The landing page is prerendered and needs none of this,
 * so an unconfigured deploy is a legitimate state — it just has to say so.
 */
const DEV_DEFAULT = "postgres://viraly:viraly@localhost:5433/viraly";

export const DATABASE_URL =
  process.env.DATABASE_URL ?? (process.env.NODE_ENV === "production" ? "" : DEV_DEFAULT);

let sql: postgres.Sql | undefined;

/** One pool per process. */
export function db(): postgres.Sql {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. The queue, the rate limiter and the HTTP cache all live in Postgres, " +
        "so crawling needs one; the landing page does not.",
    );
  }
  sql ??= postgres(DATABASE_URL, { max: 8, onnotice: () => {} });
  return sql;
}

/** Idempotent. Called on worker start; safe to call repeatedly. */
export async function applySchema(): Promise<void> {
  const ddl = await readFile(path.join(process.cwd(), "lib/db/schema.sql"), "utf8");
  await db().unsafe(ddl);
}
