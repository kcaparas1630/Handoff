// Decrypted payload shapes. Every decrypt is validated against one of these before use.
import { z } from "zod";
import { birthdateSchema, inviteeEmailSchema } from "@handoff/contracts";

const payloadVersion = z.literal(1);

export const userProfilePayloadSchema = z.object({
  schemaVersion: payloadVersion,
  displayName: z.string().nullable(),
});

export const workspaceProfilePayloadSchema = z.object({
  schemaVersion: payloadVersion,
  name: z.string(),
});

export const childProfilePayloadSchema = z.object({
  schemaVersion: payloadVersion,
  name: z.string(),
  birthdate: birthdateSchema.nullable(),
});

export const inviteePayloadSchema = z.object({
  schemaVersion: payloadVersion,
  email: inviteeEmailSchema,
});

export const idempotentResponsePayloadSchema = z.object({
  schemaVersion: payloadVersion,
  status: z.int().min(100).max(599),
  body: z.unknown(),
});
