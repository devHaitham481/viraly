import postgres from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://viraly:viraly@localhost:5433/viraly";

let sql: postgres.Sql | undefined;

/** One pool per process. */
export function db(): postgres.Sql {
  sql ??= postgres(DATABASE_URL, { max: 8, onnotice: () => {} });
  return sql;
}

/** Idempotent. Called on worker start; safe to call repeatedly. */
export async function applySchema(): Promise<void> {
  const ddl = await readFile(path.join(process.cwd(), "lib/db/schema.sql"), "utf8");
  await db().unsafe(ddl);
}
