import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import { careSessions } from "./care";
import { children } from "./children";
import {
  captureInputKind,
  captureStatus,
  eventKind,
  eventStatus,
  revisionOperation,
  timePrecision,
} from "./enums";
import { handoffSchema } from "./handoff-schema";
import { users } from "./identity";

// One submission by one author: a recording, typed text, or a manual structured entry.
export const captures = handoffSchema.table(
  "captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    childId: uuid("child_id").notNull(),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    careSessionId: uuid("care_session_id"),
    // Client-generated, so a retried submission resolves to the same capture.
    clientCaptureId: uuid("client_capture_id").notNull(),
    inputKind: captureInputKind("input_kind").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
    timezone: text("timezone").notNull(),
    locale: text("locale").notNull(),
    // Raw transcript, formatted text, and the reviewable draft under the workspace key.
    contentCiphertext: jsonb("content_ciphertext"),
    draftVersion: integer("draft_version").notNull().default(0),
    // Versions the encrypted draft payload, not the row's edit count.
    schemaVersion: integer("schema_version").notNull(),
    promptVersion: text("prompt_version"),
    modelId: text("model_id"),
    status: captureStatus("status").notNull().default("awaiting_upload"),
    errorCode: text("error_code"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("captures_author_client_capture_key").on(
      table.workspaceId,
      table.authorUserId,
      table.clientCaptureId,
    ),
    // Target of the event composite key, so a capture and its events share one child.
    uniqueIndex("captures_workspace_child_id_key").on(table.workspaceId, table.childId, table.id),
    foreignKey({
      columns: [table.workspaceId, table.childId],
      foreignColumns: [children.workspaceId, children.id],
      name: "captures_child_fk",
    }),
    // An optional session must belong to the same child and the same author.
    foreignKey({
      columns: [table.workspaceId, table.childId, table.authorUserId, table.careSessionId],
      foreignColumns: [
        careSessions.workspaceId,
        careSessions.childId,
        careSessions.userId,
        careSessions.id,
      ],
      name: "captures_care_session_fk",
    }),
    index("captures_child_status_created_idx").on(
      table.workspaceId,
      table.childId,
      table.status,
      table.createdAt,
    ),
    index("captures_author_status_idx").on(table.authorUserId, table.status),
  ],
);

// Current projection of confirmed care facts. Only the event service writes here, under a lock.
export const events = handoffSchema.table(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    childId: uuid("child_id").notNull(),
    captureId: uuid("capture_id").notNull(),
    // Stable id of the draft candidate this event was confirmed from.
    sourceCandidateId: uuid("source_candidate_id").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    lastEditedByUserId: uuid("last_edited_by_user_id")
      .notNull()
      .references(() => users.id),
    kind: eventKind("kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    timezone: text("timezone").notNull(),
    timePrecision: timePrecision("time_precision").notNull(),
    // Amount, unit, and kind-specific details under the workspace key.
    payloadCiphertext: jsonb("payload_ciphertext").notNull(),
    important: boolean("important").notNull().default(false),
    status: eventStatus("status").notNull().default("active"),
    currentRevisionId: uuid("current_revision_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  // The return type is annotated so TypeScript can resolve this table without first resolving
  // event_revisions, which points back at it.
  (table): PgTableExtraConfigValue[] => [
    // Confirming the same capture twice cannot create a second event for one candidate.
    uniqueIndex("events_capture_candidate_key").on(table.captureId, table.sourceCandidateId),
    uniqueIndex("events_workspace_child_id_key").on(table.workspaceId, table.childId, table.id),
    foreignKey({
      columns: [table.workspaceId, table.childId, table.captureId],
      foreignColumns: [captures.workspaceId, captures.childId, captures.id],
      name: "events_capture_fk",
    }),
    // Hand-edited to DEFERRABLE INITIALLY DEFERRED in the migration: the event and its first
    // revision point at each other and are inserted in one transaction, in either order.
    foreignKey({
      columns: [table.workspaceId, table.childId, table.id, table.currentRevisionId],
      foreignColumns: [
        eventRevisions.workspaceId,
        eventRevisions.childId,
        eventRevisions.eventId,
        eventRevisions.id,
      ],
      name: "events_current_revision_fk",
    }),
    index("events_child_occurred_idx").on(
      table.workspaceId,
      table.childId,
      table.occurredAt.desc().nullsLast(),
      table.id,
    ),
    // Display fallback for events whose occurrence time is unknown.
    index("events_child_created_idx").on(table.workspaceId, table.childId, table.createdAt.desc()),
    check(
      "events_ended_after_occurred",
      sql`"ended_at" IS NULL OR ("occurred_at" IS NOT NULL AND "ended_at" >= "occurred_at")`,
    ),
    check(
      "events_unknown_time_precision",
      sql`("occurred_at" IS NULL) = ("time_precision" = 'unknown')`,
    ),
  ],
);

// Immutable published history. One row per published change, numbered by the child's counter.
export const eventRevisions = handoffSchema.table(
  "event_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    childId: uuid("child_id").notNull(),
    eventId: uuid("event_id").notNull(),
    // Allocated from children.journal_seq while that child's row is locked.
    journalSeq: bigint("journal_seq", { mode: "number" }).notNull(),
    eventVersion: integer("event_version").notNull(),
    operation: revisionOperation("operation").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    // Canonical snapshot and optional source quote under the workspace key.
    contentCiphertext: jsonb("content_ciphertext").notNull(),
    // Offsets into the raw transcript, not formatted text. Null for manual entry.
    sourceStart: integer("source_start"),
    sourceEnd: integer("source_end"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table): PgTableExtraConfigValue[] => [
    // Also serves as the required (child_id, journal_seq) read index for brief windows.
    uniqueIndex("event_revisions_child_journal_seq_key").on(table.childId, table.journalSeq),
    uniqueIndex("event_revisions_event_version_key").on(table.eventId, table.eventVersion),
    // Target of the deferred current-revision key on events.
    uniqueIndex("event_revisions_workspace_child_event_id_key").on(
      table.workspaceId,
      table.childId,
      table.eventId,
      table.id,
    ),
    foreignKey({
      columns: [table.workspaceId, table.childId, table.eventId],
      foreignColumns: [events.workspaceId, events.childId, events.id],
      name: "event_revisions_event_fk",
    }),
  ],
);
