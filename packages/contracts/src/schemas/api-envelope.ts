import { z } from "zod";

// Closed set so clients can branch on failures; §8 forbids leaking stack traces or payload values.
export const apiErrorCodeSchema = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "validation_failed",
  "idempotency_key_reused",
  "rate_limited",
  "provider_unavailable",
  "internal",
]);

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string(),
  requestId: z.string().min(1),
  retryable: z.boolean(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
});

// UUID only: §8 rejects free-text keys because they could carry personal data.
export const idempotencyKeySchema = z.uuid();

export const versionSchema = z.int().positive();

// Same shape as versionSchema; named for the request field that guards against last-write-wins.
export const expectedVersionSchema = versionSchema;

export const cursorPageQuerySchema = z.object({
  // Opaque server-issued cursor; clients must not construct or parse it.
  cursor: z.string().min(1).max(512).optional(),
  // Query strings arrive as text, so limit is coerced before range checks.
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function cursorPage<ItemSchema extends z.ZodType>(itemSchema: ItemSchema) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });
}
