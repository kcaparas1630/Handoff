import { pgSchema } from "drizzle-orm/pg-core";

// Application tables live in a private schema so Supabase's Data API never exposes them.
export const handoffSchema = pgSchema("handoff");
