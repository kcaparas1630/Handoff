import { defineConfig } from "drizzle-kit";

// The migration role is separate from the runtime API role; there is no default fallback URL.
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  throw new Error(
    "DATABASE_MIGRATION_URL is not set. Set it to the migration role's connection string, " +
      "for example postgres://postgres:...@localhost:55432/handoff_dev.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/*.ts",
  out: "./migrations",
  // Keeps drizzle-kit from diffing Supabase's own public/auth objects.
  schemaFilter: ["handoff"],
  dbCredentials: { url },
});
