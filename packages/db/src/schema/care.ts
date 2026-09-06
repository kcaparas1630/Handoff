import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { children } from "./children";
import { briefStatus, careEndReason } from "./enums";
import { handoffSchema } from "./handoff-schema";
import { users, workspaceMemberships } from "./identity";

// A caregiver's declared "I am caring for this child now". Several caregivers may overlap.
export const careSessions = handoffSchema.table(
  "care_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    childId: uuid("child_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // Server assigned; a device's claimed start time is metadata, not evidence of a transfer.
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    endReason: careEndReason("end_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.childId],
      foreignColumns: [children.workspaceId, children.id],
      name: "care_sessions_child_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      name: "care_sessions_membership_fk",
    }),
    // Target of the capture composite key: a capture's session must be the same child and author.
    uniqueIndex("care_sessions_workspace_child_user_id_key").on(
      table.workspaceId,
      table.childId,
      table.userId,
      table.id,
    ),
    // At most one open session per child and user. Ended sessions may repeat freely.
    uniqueIndex("care_sessions_open_per_child_user_idx")
      .on(table.childId, table.userId)
      .where(sql`${table.endedAt} IS NULL`),
    index("care_sessions_child_open_idx").on(table.workspaceId, table.childId, table.endedAt),
    check("care_sessions_end_after_start", sql`"ended_at" IS NULL OR "ended_at" >= "started_at"`),
  ],
);

// One recipient's bounded snapshot of a child's journal, from a cursor position through a cutoff.
export const handoffBriefs = handoffSchema.table(
  "handoff_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    childId: uuid("child_id").notNull(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id),
    fromSeqExclusive: bigint("from_seq_exclusive", { mode: "number" }).notNull(),
    throughSeqInclusive: bigint("through_seq_inclusive", { mode: "number" }).notNull(),
    // Set only for a disclosed first-handoff window that skips older history.
    initialWindowStart: timestamp("initial_window_start", { withTimezone: true, mode: "date" }),
    // Displayed entries, source revision ids, and context labels under the workspace key.
    snapshotCiphertext: jsonb("snapshot_ciphertext").notNull(),
    rendererVersion: text("renderer_version").notNull(),
    status: briefStatus("status").notNull().default("ready"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true, mode: "date" }),
    startedSessionId: uuid("started_session_id").references(() => careSessions.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.childId],
      foreignColumns: [children.workspaceId, children.id],
      name: "handoff_briefs_child_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.recipientUserId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      name: "handoff_briefs_recipient_fk",
    }),
    index("handoff_briefs_recipient_created_idx").on(
      table.workspaceId,
      table.childId,
      table.recipientUserId,
      table.createdAt.desc(),
    ),
    // An empty initial brief at counter zero is valid, so the lower bound is zero, not one.
    check(
      "handoff_briefs_seq_window",
      sql`"from_seq_exclusive" >= 0 AND "from_seq_exclusive" <= "through_seq_inclusive"`,
    ),
  ],
);

// How far one recipient has acknowledged a child's journal. Monotonic; never moves backward.
export const handoffCursors = handoffSchema.table(
  "handoff_cursors",
  {
    workspaceId: uuid("workspace_id").notNull(),
    childId: uuid("child_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    acknowledgedSeq: bigint("acknowledged_seq", { mode: "number" }).notNull().default(0),
    lastAcknowledgedBriefId: uuid("last_acknowledged_brief_id").references(() => handoffBriefs.id),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.childId, table.userId] }),
    foreignKey({
      columns: [table.workspaceId, table.childId],
      foreignColumns: [children.workspaceId, children.id],
      name: "handoff_cursors_child_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      name: "handoff_cursors_membership_fk",
    }),
  ],
);
