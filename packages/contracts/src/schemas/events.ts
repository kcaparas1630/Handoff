import { z } from "zod";
import {
  cursorPage,
  cursorPageQuerySchema,
  expectedVersionSchema,
  versionSchema,
} from "./api-envelope";
import { timezoneSchema } from "./identity";

export const eventKindSchema = z.enum(["feed", "diaper", "sleep", "milestone", "note"]);
export const timePrecisionSchema = z.enum(["exact", "approximate", "unknown"]);
export const amountUnitSchema = z.enum(["ml", "oz", "g", "minutes"]);
export const eventStatusSchema = z.enum(["active", "deleted"]);
export const revisionOperationSchema = z.enum(["created", "corrected", "deleted", "media_updated"]);

// Amounts travel as decimal strings so numeric(10,2) round-trips exactly; a float would
// silently rewrite the value the caregiver approved. Eight integer digits plus two decimals
// is the whole column range, and the refine rejects zero and 0.00.
export const amountValueSchema = z
  .string()
  .regex(/^\d{1,8}(?:\.\d{1,2})?$/, "Expected a decimal amount with up to two decimal places")
  .refine((value) => Number(value) > 0, "Expected an amount greater than zero");

export const feedMethodSchema = z.enum(["bottle", "breast", "solid", "unknown"]);
export const diaperContentsSchema = z.enum(["wet", "stool", "both", "unknown"]);
export const sleepStateSchema = z.enum(["interval", "started", "ended"]);
export const noteIntentSchema = z.enum(["observation", "planned", "question"]);

const feedDetailsSchema = z.object({
  kind: z.literal("feed"),
  method: feedMethodSchema,
  description: z.string().trim().min(1).max(500).optional(),
});

const diaperDetailsSchema = z.object({
  kind: z.literal("diaper"),
  contents: diaperContentsSchema,
  // "A lot" stays the caregiver's words; §3 forbids turning it into an invented count.
  quantity: z.string().trim().min(1).max(80).optional(),
  note: z.string().trim().min(1).max(500).optional(),
});

const sleepDetailsSchema = z.object({
  kind: z.literal("sleep"),
  state: sleepStateSchema,
  note: z.string().trim().min(1).max(500).optional(),
});

const milestoneDetailsSchema = z.object({
  kind: z.literal("milestone"),
  description: z.string().trim().min(1).max(500),
  quote: z.string().trim().min(1).max(500).optional(),
  // The caregiver's report that this was a first, not an independently established fact.
  reportedFirst: z.boolean(),
});

const noteDetailsSchema = z.object({
  kind: z.literal("note"),
  text: z.string().trim().min(1).max(2000),
  intent: noteIntentSchema,
});

export const eventDetailsSchema = z.discriminatedUnion("kind", [
  feedDetailsSchema,
  diaperDetailsSchema,
  sleepDetailsSchema,
  milestoneDetailsSchema,
  noteDetailsSchema,
]);

// The decrypted shape of events.payload_ciphertext. Versioned because stored records outlive
// this release; readers must keep handling supported older versions.
export const eventPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  amountValue: amountValueSchema.nullable(),
  amountUnit: amountUnitSchema.nullable(),
  details: eventDetailsSchema,
});

export const eventDtoSchema = z.object({
  id: z.uuid(),
  childId: z.uuid(),
  workspaceId: z.uuid(),
  captureId: z.uuid(),
  kind: eventKindSchema,
  // Null occurrence means the time was never stated; it is not "happened at capture time".
  occurredAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  timezone: timezoneSchema,
  timePrecision: timePrecisionSchema,
  amountValue: amountValueSchema.nullable(),
  amountUnit: amountUnitSchema.nullable(),
  details: eventDetailsSchema,
  important: z.boolean(),
  status: eventStatusSchema,
  version: versionSchema,
  createdByUserId: z.uuid(),
  lastEditedByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  currentRevisionId: z.uuid(),
  sourceQuote: z.string().nullable(),
});

// Partial correction. Omitted fields keep their stored value; an explicit null clears one.
// The server merges onto the current event and revalidates the result with the domain rules,
// so this schema deliberately carries no cross-field semantics.
export const updateEventRequestSchema = z.object({
  expectedVersion: expectedVersionSchema,
  occurredAt: z.iso.datetime().nullable().optional(),
  endedAt: z.iso.datetime().nullable().optional(),
  timezone: timezoneSchema.optional(),
  timePrecision: timePrecisionSchema.optional(),
  amountValue: amountValueSchema.nullable().optional(),
  amountUnit: amountUnitSchema.nullable().optional(),
  details: eventDetailsSchema.optional(),
  important: z.boolean().optional(),
});

export const deleteEventRequestSchema = z.object({
  expectedVersion: expectedVersionSchema,
});

export const eventsListQuerySchema = cursorPageQuerySchema.extend({
  kind: eventKindSchema.optional(),
});

export const eventsPageSchema = cursorPage(eventDtoSchema);

// The canonical fields copied into an immutable revision; excludes identifiers that cannot change.
export const revisionEventSchema = z.object({
  kind: eventKindSchema,
  occurredAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  timezone: timezoneSchema,
  timePrecision: timePrecisionSchema,
  amountValue: amountValueSchema.nullable(),
  amountUnit: amountUnitSchema.nullable(),
  details: eventDetailsSchema,
  important: z.boolean(),
  status: eventStatusSchema,
});

// The decrypted shape of event_revisions.content_ciphertext. Asset IDs stay empty until
// milestone 4; the snapshot never holds credentials or signed URLs.
export const revisionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  event: revisionEventSchema,
  sourceQuote: z.string().nullable(),
  readyAssetIds: z.array(z.uuid()),
});
