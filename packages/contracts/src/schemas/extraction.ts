import { z } from "zod";
import { captureAmbiguitySchema } from "./captures";
import { amountUnitSchema, amountValueSchema, eventDetailsSchema, eventKindSchema } from "./events";
import { timezoneSchema } from "./identity";

// Clock components exactly as heard. The extractor never picks a calendar day or a meridiem:
// resolveEventTime turns these into proposals the caregiver confirms.
export const spokenTimeSchema = z
  .object({
    hour: z.int().min(0).max(23).optional(),
    minute: z.int().min(0).max(59).optional(),
    meridiem: z.enum(["am", "pm"]).optional(),
    // -1 is an explicit "yesterday"; omitting it means the day was never stated.
    dayOffset: z.union([z.literal(0), z.literal(-1)]).optional(),
    isNow: z.boolean().optional(),
  })
  .strict();

// One candidate as the model reports it. Strict on purpose: an id, an absolute occurredAt, a
// discard flag, or any tenant/child field coming back from the model is rejected, not ignored.
export const extractionCandidateSchema = z
  .object({
    kind: eventKindSchema,
    spokenTime: spokenTimeSchema.nullable(),
    // A sleep interval needs both ends; every other kind leaves this null.
    spokenEndTime: spokenTimeSchema.nullable(),
    amountValue: amountValueSchema.nullable(),
    amountUnit: amountUnitSchema.nullable(),
    details: eventDetailsSchema,
    sourceQuote: z.string().min(1),
    // Offsets into the raw transcript, never the formatted text.
    sourceStart: z.int().nonnegative(),
    sourceEnd: z.int().positive(),
    ambiguities: z.array(captureAmbiguitySchema),
    negated: z.boolean(),
    planned: z.boolean(),
    mentionsOtherChild: z.boolean(),
  })
  .strict()
  .refine((value) => value.sourceEnd > value.sourceStart, {
    path: ["sourceEnd"],
    message: "Expected the source span to end after it starts",
  });

export const extractionOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    formattedText: z.string(),
    candidates: z.array(extractionCandidateSchema).max(20),
    // Free-form caveats shown to the reviewer; they carry no publishing authority.
    notes: z.array(z.string().trim().min(1).max(300)).max(5),
  })
  .strict();

// What the worker sends. Declared here so the request shape can be asserted and logged without
// the transcript: nothing beyond the spoken text and its formatting context belongs in the call.
export const extractionInputSchema = z.object({
  schemaVersion: z.literal(1),
  rawTranscript: z.string().max(4000),
  recordingStartedAt: z.iso.datetime(),
  timezone: timezoneSchema,
  locale: z.string().trim().min(2).max(35),
  // A first name or the literal "the child"; never a birthdate, roster, or history.
  childAlias: z.string().trim().min(1).max(80),
  promptVersion: z.string().trim().min(1).max(40),
});

// Stored on the capture row's metadata so a model or prompt change is attributable. It is not
// part of the draft the caregiver reviews.
export const extractionProvenanceSchema = z.object({
  provider: z.literal("anthropic"),
  modelId: z.string().trim().min(1).max(120),
  promptVersion: z.string().trim().min(1).max(40),
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  durationMs: z.int().nonnegative(),
});

// The labelled half of tests/fixtures/extraction-cases.jsonl. Fixtures record only what was
// explicitly spoken, so source spans and stable IDs are deliberately absent.
export const expectedCandidateSchema = z
  .object({
    kind: eventKindSchema,
    spokenTime: spokenTimeSchema.nullable(),
    spokenEndTime: spokenTimeSchema.nullable().optional(),
    amountValue: amountValueSchema.nullable(),
    amountUnit: amountUnitSchema.nullable(),
    details: eventDetailsSchema,
    ambiguities: z.array(captureAmbiguitySchema),
    negated: z.boolean(),
    planned: z.boolean(),
    mentionsOtherChild: z.boolean(),
  })
  .strict();
