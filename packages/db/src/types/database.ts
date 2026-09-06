import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../schema";

export type HandoffDatabase = PostgresJsDatabase<typeof schema>;

// Derived from the client so repositories never restate Drizzle's transaction generics.
export type HandoffTransaction = Parameters<Parameters<HandoffDatabase["transaction"]>[0]>[0];
