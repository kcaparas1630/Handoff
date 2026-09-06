import {
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { children } from "./children";
import { jobKind, jobStatus } from "./enums";
import { handoffSchema } from "./handoff-schema";
import { captures } from "./journal";
import { mediaAssets } from "./media";
import { workspaces } from "./identity";

// Durable leased work. Claimed by the dispatcher credential, not the mobile API credential.
export const jobs = handoffSchema.table(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: jobKind("kind").notNull(),
    // Semantic identity of the work. A retried enqueue of the same unit inserts nothing.
    dedupeKey: text("dedupe_key").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    // Nullable because reconcile and maintenance kinds are not scoped to one tenant.
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    childId: uuid("child_id"),
    captureId: uuid("capture_id"),
    assetId: uuid("asset_id"),
    // Identifiers and stage arguments only. Transcripts stay in the encrypted capture.
    payload: jsonb("payload").notNull(),
    // Stage markers such as "transcribed", never transcript text or any other personal content.
    checkpoint: jsonb("checkpoint"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
    // A short code such as `transcription_timeout`; never a provider body or a message.
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("jobs_dedupe_key").on(table.dedupeKey),
    // Composite keys are MATCH SIMPLE, so they only apply once every referenced column is set.
    // A reconcile job with no child and no capture is unconstrained by either of them.
    foreignKey({
      columns: [table.workspaceId, table.childId],
      foreignColumns: [children.workspaceId, children.id],
      name: "jobs_child_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.childId, table.captureId],
      foreignColumns: [captures.workspaceId, captures.childId, captures.id],
      name: "jobs_capture_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.childId, table.assetId],
      foreignColumns: [mediaAssets.workspaceId, mediaAssets.childId, mediaAssets.id],
      name: "jobs_asset_fk",
    }),
    // The claim scan: queued work whose availability time has arrived.
    index("jobs_status_available_idx").on(table.status, table.availableAt),
    // The reclaim scan: leases a crashed worker never released.
    index("jobs_status_lease_expires_idx").on(table.status, table.leaseExpiresAt),
  ],
);
