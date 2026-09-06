import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { HandoffDatabase } from "./types/database";

export interface DbClientOptions {
  url: string;
  maxConnections: number;
}

export interface DbClient {
  db: HandoffDatabase;
  close: () => Promise<void>;
}

/**
 * Creates a pooled client. The caller owns configuration; this module never reads the environment
 * and holds no module-level singleton, so tests and the API can run separate pools.
 */
export function createDbClient({ url, maxConnections }: DbClientOptions): DbClient {
  // Prepared statements are disabled because Supabase's pooler uses transaction pooling.
  const sql = postgres(url, { max: maxConnections, prepare: false });
  const db = drizzle(sql, { schema });
  return {
    db,
    close: async () => {
      await sql.end();
    },
  };
}
