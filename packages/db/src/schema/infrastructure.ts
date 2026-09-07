import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea } from "./bytea";
import { dataKeys } from "./data-keys";
import { encryptionScopeKind, webhookStatus } from "./enums";
import { handoffSchema } from "./handoff-schema";
import { users, workspaces } from "./identity";

// Replay protection for state-changing requests. Same key and body returns the same effect.
export const idempotencyRequests = handoffSchema.table(
  "idempotency_requests",
  {
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    operation: text("operation").notNull(),
    key: uuid("key").notNull(),
    // Which data key scope encrypted the fingerprint and response; user scope means the actor.
    scopeKind: encryptionScopeKind("scope_kind").notNull(),
    scopeWorkspaceId: uuid("scope_workspace_id").references(() => workspaces.id),
    // Keyed, not a plain hash: request bodies contain low-entropy personal values.
    requestFingerprint: bytea("request_fingerprint").notNull(),
    fingerprintKeyId: uuid("fingerprint_key_id")
      .notNull()
      .references(() => dataKeys.id),
    responseStatus: integer("response_status").notNull(),
    responseCiphertext: jsonb("response_ciphertext"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorUserId, table.operation, table.key] }),
    check(
      "idempotency_requests_scope_check",
      sql`(${table.scopeKind} = 'workspace') = (${table.scopeWorkspaceId} IS NOT NULL)`,
    ),
  ],
);

// Verified provider events only: IDs and lifecycle facts, never Clerk's raw body.
export const webhookInbox = handoffSchema.table(
  "webhook_inbox",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    clerkOrgId: text("clerk_org_id"),
    clerkUserId: text("clerk_user_id"),
    clerkMembershipId: text("clerk_membership_id"),
    clerkInvitationId: text("clerk_invitation_id"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    status: webhookStatus("status").notNull().default("received"),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
    retryCount: integer("retry_count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.provider, table.eventId] })],
);

// Approved IDs, operation names, and safe codes only; no raw sensitive content.
// Entity references are plain IDs, not foreign keys, so a record outlives what it describes.
export const auditLog = handoffSchema.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id"),
  childId: uuid("child_id"),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  requestId: text("request_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

// Numbers only: how much paid provider work one workspace has consumed on one UTC day. It holds
// no identifiers beyond the workspace and no content, and it is what the daily spend cap reads.
export const providerUsage = handoffSchema.table(
  "provider_usage",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    day: date("day", { mode: "string" }).notNull(),
    tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
    tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
    audioSeconds: bigint("audio_seconds", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.day] })],
);
