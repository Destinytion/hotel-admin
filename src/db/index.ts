import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local.");
}

// One pool for the whole process, kept across hot reloads in development.
const globalForDb = globalThis as unknown as { pgPool?: Pool };
// A hosted database's address carries sslmode=require, which turns encryption on.
// DB_POOL_MAX keeps a small hosted database from running out of connections.
const pool =
  globalForDb.pgPool ??
  new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX) || 10, idleTimeoutMillis: 30_000 });
if (!globalForDb.pgPool) {
  // A dropped connection (for example when Postgres restarts) is logged and
  // replaced on the next request, instead of stopping the whole app.
  pool.on("error", (error) => console.error("Database connection lost:", error.message));
}
if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
