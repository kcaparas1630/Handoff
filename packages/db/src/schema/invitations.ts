import { sql } from "drizzle-orm";
import {
  foreignKey,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea } from "./bytea";
import { children } from "./children";
import { dataKeys } from "./data-keys";
import { appRole, caregiverRelationship, childPermission, invitationStatus } from "./enums";
import { handoffSchema } from "./handoff-schema";
import { users, workspaces } from "./identity";

export const invitationIntents = handoffSchema.table(
  "invitation_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    clerkInvitationId: text("clerk_invitation_id").unique(),
    // Normalized invitee email under the workspace-scoped data key.
    inviteeCiphertext: jsonb("invitee_ciphertext").notNull(),
    // Workspace-keyed HMAC, never a plain email hash; equality index only.
    emailLookupHash: bytea("email_lookup_hash").notNull(),
    emailLookupKeyId: uuid("email_lookup_key_id")
      .notNull()
      .references(() => dataKeys.id),
    intendedAppRole: appRole("intended_app_role").notNull(),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id),
    status: invitationStatus("status").notNull().default("pending_send"),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id),
    // Enforced locally as well as by any provider expiry.
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("invitation_intents_workspace_id_id_key").on(table.workspaceId, table.id),
    // One open invitation per address per workspace; resolved and cancelled ones may repeat.
    uniqueIndex("invitation_intents_open_lookup_idx")
      .on(table.workspaceId, table.emailLookupHash)
      .where(sql`${table.status} IN ('pending_send', 'sent', 'reconcile_needed')`),
  ],
);

// Proposed child access. Applied to child_caregivers only after verified acceptance.
export const invitationChildGrants = handoffSchema.table(
  "invitation_child_grants",
  {
    workspaceId: uuid("workspace_id").notNull(),
    invitationIntentId: uuid("invitation_intent_id").notNull(),
    childId: uuid("child_id").notNull(),
    relationship: caregiverRelationship("relationship").notNull(),
    permission: childPermission("permission").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.invitationIntentId, table.childId] }),
    foreignKey({
      columns: [table.workspaceId, table.invitationIntentId],
      foreignColumns: [invitationIntents.workspaceId, invitationIntents.id],
      name: "invitation_child_grants_intent_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.childId],
      foreignColumns: [children.workspaceId, children.id],
      name: "invitation_child_grants_child_fk",
    }),
  ],
);
