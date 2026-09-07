import {
  bigint,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { handoffSchema } from "./handoff-schema";
import { appRole, membershipStatus, userStatus, workspaceKind, workspaceStatus } from "./enums";

// Minimal identity projection. Clerk owns login methods, sessions, and email verification.
export const users = handoffSchema.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  // Display name under the user-scoped data key; there is no plaintext shadow column.
  profileCiphertext: jsonb("profile_ciphertext").notNull(),
  status: userStatus("status").notNull().default("active"),
  processingNoticeVersion: text("processing_notice_version"),
  processingNoticeAcceptedAt: timestamp("processing_notice_accepted_at", {
    withTimezone: true,
    mode: "date",
  }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const workspaces = handoffSchema.table("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkOrgId: text("clerk_org_id").notNull().unique(),
  kind: workspaceKind("kind").notNull(),
  // Workspace display name under the workspace-scoped data key.
  profileCiphertext: jsonb("profile_ciphertext").notNull(),
  timezone: text("timezone").notNull(),
  status: workspaceStatus("status").notNull().default("active"),
  // When deletion was requested. The key retention window is measured from it, so it must not
  // move when a later purge stage touches the row.
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  storageBudgetBytes: bigint("storage_budget_bytes", { mode: "number" }).notNull(),
  storageReservedBytes: bigint("storage_reserved_bytes", { mode: "number" }).notNull().default(0),
  storageUsedBytes: bigint("storage_used_bytes", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const workspaceMemberships = handoffSchema.table(
  "workspace_memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    clerkMembershipId: text("clerk_membership_id").notNull().unique(),
    // Server-controlled mapping from the Clerk role and a validated invitation intent.
    appRole: appRole("app_role").notNull(),
    status: membershipStatus("status").notNull().default("active"),
    providerVerifiedAt: timestamp("provider_verified_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_memberships_user_status_idx").on(table.userId, table.status),
  ],
);
