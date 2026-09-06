import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { caregiverRelationship, childPermission, childStatus, membershipStatus } from "./enums";
import { handoffSchema } from "./handoff-schema";
import { users, workspaceMemberships, workspaces } from "./identity";

export const children = handoffSchema.table(
  "children",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    // Name and optional birthdate under the workspace-scoped data key.
    profileCiphertext: jsonb("profile_ciphertext").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    journalSeq: bigint("journal_seq", { mode: "number" }).notNull().default(0),
    status: childStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    // Target of the composite foreign keys that keep child-owned rows inside one workspace.
    uniqueIndex("children_workspace_id_id_key").on(table.workspaceId, table.id),
    index("children_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const childCaregivers = handoffSchema.table(
  "child_caregivers",
  {
    workspaceId: uuid("workspace_id").notNull(),
    childId: uuid("child_id").notNull(),
    userId: uuid("user_id").notNull(),
    // Descriptive only; permission decides capabilities, under the member's app-role ceiling.
    relationship: caregiverRelationship("relationship").notNull(),
    permission: childPermission("permission").notNull(),
    status: membershipStatus("status").notNull().default("active"),
    grantedByUserId: uuid("granted_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.childId, table.userId] }),
    foreignKey({
      columns: [table.workspaceId, table.childId],
      foreignColumns: [children.workspaceId, children.id],
      name: "child_caregivers_child_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      name: "child_caregivers_membership_fk",
    }),
    index("child_caregivers_user_status_child_idx").on(
      table.workspaceId,
      table.userId,
      table.status,
      table.childId,
    ),
  ],
);
