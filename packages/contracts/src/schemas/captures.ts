import { z } from "zod";
import { versionSchema } from "./api-envelope";
import {
  amountUnitSchema,
  amountValueSchema,
  eventDetailsSchema,
  eventDtoSchema,
  eventKindSchema,
  timePrecisionSchema,
} from "./events";
import { timezoneSchema } from "./identity";

export const captureInputKindSchema = z.enum(["audio", "text", "manual"]);

export const captureStatusSchema = z.enum([
  "awaiting_upload",
  "queued",
  "processing",
  "needs_review",
  "confirmed",
  "failed",
  "cancelled",
]);

// Closed set so the review UI can ask a specific question instead of showing free text,
// and so an extractor cannot invent a new flag the client silently ignores.
export const captureAmbiguitySchema = z.enum([
  "date_unknown",
  "am_pm_unknown",
  "amount_unknown",
  "unit_unknown",
  "negation",
  "planned",
  "other_child",
  "duplicate_suspected",
]);

// One reviewable line in a draft. IDs are stable across edits so the confirmation transaction
// can dedupe with UNIQUE (capture_id, source_candidate_id).
export const draftCandidateSchema = z.object({
  id: z.uuid(),
  kind: eventKindSchema,
  occurredAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  timePrecision: timePrecisionSchema,
  amountValue: amountValueSchema.nullable(),
  amountUnit: amountUnitSchema.nullable(),
  details: eventDetailsSchema,
  important: z.boolean(),
  sourceQuote: z.string().nullable(),
  // Offsets into the raw transcript, never the formatted text; null for manual entry.
  sourceStart: z.int().nonnegative().nullable(),
  sourceEnd: z.int().nonnegative().nullable(),
  ambiguities: z.array(captureAmbiguitySchema),
  discarded: z.boolean(),
});

// The decrypted shape of captures.content_ciphertext.
export const captureDraftSchema = z.object({
  schemaVersion: z.literal(1),
  rawTranscript: z.string().nullable(),
  formattedText: z.string().nullable(),
  candidates: z.array(draftCandidateSchema),
});

// Audio capture arrives in milestone 3 together with upload authorization and the worker,
// so this milestone accepts only the two input kinds the client can complete in one request.
export const createCaptureInputKindSchema = z.enum(["manual", "text"]);

export const createCaptureRequestSchema = z
  .object({
    childId: z.uuid(),
    // Client-generated and stable across retries; unique per (workspace, author).
    clientCaptureId: z.uuid(),
    inputKind: createCaptureInputKindSchema,
    capturedAt: z.iso.datetime(),
    timezone: timezoneSchema,
    locale: z.string().trim().min(2).max(35),
    careSessionId: z.uuid().optional(),
    // Manual entry skips extraction: the client sends the reviewed entry as one candidate.
    candidates: z.array(draftCandidateSchema).min(1).optional(),
    text: z.string().trim().min(1).max(4000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.inputKind === "manual" && value.candidates === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Manual capture requires the reviewed entry as a candidate",
      });
    }
    if (value.inputKind === "text" && value.text === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: "Text capture requires the typed text",
      });
    }
  });

export const captureDtoSchema = z.object({
  id: z.uuid(),
  childId: z.uuid(),
  workspaceId: z.uuid(),
  authorUserId: z.uuid(),
  inputKind: captureInputKindSchema,
  status: captureStatusSchema,
  capturedAt: z.iso.datetime(),
  timezone: timezoneSchema,
  locale: z.string(),
  draftVersion: z.int().nonnegative(),
  // Null unless the caller may read this draft; another caregiver's unconfirmed draft is not a fact.
  draft: captureDraftSchema.nullable(),
  errorCode: z.string().nullable(),
  confirmedAt: z.iso.datetime().nullable(),
  version: versionSchema,
  createdAt: z.iso.datetime(),
});

export const updateCaptureDraftRequestSchema = z.object({
  expectedDraftVersion: z.int().nonnegative(),
  candidates: z.array(draftCandidateSchema),
});

// Source spans stay server-side: the stored draft is the source of truth for where a candidate
// came from, so a client cannot repoint a confirmed event at different transcript text.
export const confirmedCandidateSchema = draftCandidateSchema.omit({
  sourceStart: true,
  sourceEnd: true,
});

export const confirmCaptureRequestSchema = z.object({
  expectedDraftVersion: z.int().nonnegative(),
  candidates: z.array(confirmedCandidateSchema),
});

export const confirmCaptureResponseSchema = z.object({
  capture: captureDtoSchema,
  events: z.array(eventDtoSchema),
});
