import { sql } from "drizzle-orm";
import { bigint, check, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./bytea";
import { dataKeyPurpose, dataKeyState } from "./enums";
import { handoffSchema } from "./handoff-schema";
import { users, workspaces } from "./identity";

// Registry of wrapped data keys. Raw key bytes and the KEK are never stored in Postgres.
export const dataKeys = handoffSchema.table(
  "data_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    userId: uuid("user_id").references(() => users.id),
    purpose: dataKeyPurpose("purpose").notNull(),
    version: integer("version").notNull(),
    wrappedKey: bytea("wrapped_key").notNull(),
    wrappingProvider: text("wrapping_provider").notNull(),
    wrappingKeyRef: text("wrapping_key_ref").notNull(),
    wrappingContextVersion: integer("wrapping_context_version").notNull(),
    state: dataKeyState("state").notNull().default("active"),
    // Usage reserved against this key's encryption budget; rotate rather than exceed it.
    reservedEncryptions: bigint("reserved_encryptions", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "data_keys_single_scope_check",
      sql`(${table.workspaceId} IS NULL) <> (${table.userId} IS NULL)`,
    ),
    // Concurrent first use races on these two indexes so exactly one active key wins.
    uniqueIndex("data_keys_active_workspace_purpose_idx")
      .on(table.workspaceId, table.purpose)
      .where(sql`${table.state} = 'active' AND ${table.workspaceId} IS NOT NULL`),
    uniqueIndex("data_keys_active_user_purpose_idx")
      .on(table.userId, table.purpose)
      .where(sql`${table.state} = 'active' AND ${table.userId} IS NOT NULL`),
    // Partial rather than plain uniques: NULL scope columns would otherwise compare as distinct.
    uniqueIndex("data_keys_workspace_purpose_version_idx")
      .on(table.workspaceId, table.purpose, table.version)
      .where(sql`${table.workspaceId} IS NOT NULL`),
    uniqueIndex("data_keys_user_purpose_version_idx")
      .on(table.userId, table.purpose, table.version)
      .where(sql`${table.userId} IS NOT NULL`),
  ],
);
