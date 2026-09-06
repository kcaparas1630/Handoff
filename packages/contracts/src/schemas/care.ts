import { z } from "zod";
import { versionSchema } from "./api-envelope";

// Revocation and archival close sessions on the server; the app never claims physical absence.
export const careSessionEndReasonSchema = z.enum([
  "user_ended",
  "membership_revoked",
  "child_archived",
]);

export const careSessionDtoSchema = z.object({
  id: z.uuid(),
  childId: z.uuid(),
  workspaceId: z.uuid(),
  userId: z.uuid(),
  displayName: z.string().nullable(),
  // Server-confirmed start time is authoritative; an offline intent time is not a session.
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  endReason: careSessionEndReasonSchema.nullable(),
  version: versionSchema,
});

// Affects the caller's own session only; ending one caregiver's session never ends another's.
export const careActionRequestSchema = z.object({
  action: z.enum(["start", "end"]),
});

export const careListResponseSchema = z.object({
  sessions: z.array(careSessionDtoSchema),
});
