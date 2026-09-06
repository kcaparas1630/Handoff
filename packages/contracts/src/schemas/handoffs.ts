import { z } from "zod";
import { careSessionDtoSchema } from "./care";
import { eventKindSchema, timePrecisionSchema } from "./events";

export const briefStatusSchema = z.enum(["ready", "invalidated", "redacted"]);
export const briefEntryLabelSchema = z.enum(["new", "updated", "removed"]);

// Only the three dashboard essentials have a "latest known" reading worth carrying as context.
export const contextFactKindSchema = z.enum(["feed", "sleep", "diaper"]);

// One collapsed change to one event. Every entry cites the revision it was rendered from so the
// reader can open the source; text is deterministic template output, never model prose.
export const briefEntrySchema = z.object({
  eventId: z.uuid(),
  revisionId: z.uuid(),
  kind: eventKindSchema,
  label: briefEntryLabelSchema,
  text: z.string(),
  occurredAt: z.iso.datetime().nullable(),
  timePrecision: timePrecisionSchema,
  // When the change was published, which is distinct from when the care happened.
  reportedAt: z.iso.datetime(),
  authorDisplayName: z.string().nullable(),
  important: z.boolean(),
});

// Latest-known care shown as labeled context. It is not counted as a new update.
export const briefContextFactSchema = z.object({
  kind: contextFactKindSchema,
  eventId: z.uuid(),
  revisionId: z.uuid(),
  text: z.string(),
  occurredAt: z.iso.datetime().nullable(),
  timePrecision: timePrecisionSchema,
  ageLabel: z.string(),
  precedesWindow: z.boolean(),
});

// The decrypted shape of handoff_briefs.snapshot_ciphertext. Stable once written: later edits
// produce new revisions and a new brief rather than rewriting this one.
export const briefSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  rendererVersion: z.string(),
  boundary: z.object({
    fromSeqExclusive: z.int().nonnegative(),
    throughSeqInclusive: z.int().nonnegative(),
    initialWindowStart: z.iso.datetime().nullable(),
    label: z.string(),
  }),
  essentials: z.array(briefContextFactSchema),
  updates: z.array(briefEntrySchema),
  moments: z.array(briefEntrySchema),
  // Server-known unconfirmed captures, so the brief cannot look more complete than it is.
  pendingCaptureCount: z.int().nonnegative(),
  // Every revision inside the window, including the ones collapsed away.
  sourceRevisionIds: z.array(z.uuid()),
  generatedAt: z.iso.datetime(),
});

export const handoffBriefDtoSchema = z.object({
  id: z.uuid(),
  childId: z.uuid(),
  workspaceId: z.uuid(),
  recipientUserId: z.uuid(),
  status: briefStatusSchema,
  acknowledgedAt: z.iso.datetime().nullable(),
  startedSessionId: z.uuid().nullable(),
  snapshot: briefSnapshotSchema,
  // Computed per fetch: newer confirmed changes exist beyond this snapshot's cutoff.
  isStale: z.boolean(),
  newerChangeCount: z.int().nonnegative(),
  activeSessions: z.array(careSessionDtoSchema),
});

export const acknowledgeBriefRequestSchema = z.object({
  startCare: z.boolean(),
});

export const acknowledgeBriefResponseSchema = z.object({
  brief: handoffBriefDtoSchema,
  // The cursor consumes this snapshot's cutoff only; newer changes stay unread.
  acknowledgedSeq: z.int().nonnegative(),
  session: careSessionDtoSchema.nullable(),
});
