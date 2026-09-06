import { z } from "zod";
import { versionSchema } from "./api-envelope";

// This module stays a leaf so captures.ts can embed an asset in its DTO. The
// POST /captures/:captureId/complete request and response live with the other capture route
// contracts in captures.ts, which is where the capture DTO they return is defined.

export const mediaKindSchema = z.enum(["audio", "image", "video"]);

export const mediaStatusSchema = z.enum([
  "pending_upload",
  "uploaded",
  "ready",
  "rejected",
  "deleting",
  "deleted",
]);

// Storage provider, bucket, object key, and signed URLs are server-only. A client identifies an
// asset by ID and asks for a short-lived URL when it actually needs the bytes.
export const mediaAssetDtoSchema = z.object({
  id: z.uuid(),
  captureId: z.uuid(),
  childId: z.uuid(),
  workspaceId: z.uuid(),
  kind: mediaKindSchema,
  status: mediaStatusSchema,
  declaredMime: z.string().trim().min(1).max(120),
  // Null until the upload completes and the worker verifies the bytes.
  sizeBytes: z.int().nonnegative().nullable(),
  durationMs: z.int().nonnegative().nullable(),
  version: versionSchema,
  createdAt: z.iso.datetime(),
});

// A scoped, expiring authorization for exactly one allocated object. It is returned once and
// never stored: a signed URL is not an identifier and must not reappear in a later read.
export const uploadAuthorizationSchema = z.object({
  assetId: z.uuid(),
  method: z.literal("PUT"),
  url: z.url({ protocol: /^https$/ }),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
  maxBytes: z.int().positive(),
});

// Image and video attachments ride on an existing capture; audio is created with the capture.
export const attachmentKindSchema = z.enum(["image", "video"]);

export const createAssetUploadRequestSchema = z
  .object({
    kind: attachmentKindSchema,
    declaredMime: z.string().trim().min(1).max(100),
    declaredSizeBytes: z.int().positive(),
    declaredDurationMs: z.int().positive().optional(),
  })
  .refine((value) => value.kind !== "video" || value.declaredDurationMs !== undefined, {
    path: ["declaredDurationMs"],
    message: "A video upload must declare its duration",
  });

export const createAssetUploadResponseSchema = z.object({
  asset: mediaAssetDtoSchema,
  upload: uploadAuthorizationSchema,
});

// Issued at request time after fresh authorization; the URL is never stored or replayed.
export const assetReadResponseSchema = z.object({
  asset: mediaAssetDtoSchema,
  url: z.url({ protocol: /^https$/ }),
  expiresAt: z.iso.datetime(),
});

// Attachment completion returns the asset only; its capture is unchanged by an upload.
export const completeAssetUploadResponseSchema = z.object({ asset: mediaAssetDtoSchema });
