import type { z } from "zod";
import type {
  apiErrorCodeSchema,
  apiErrorSchema,
  cursorPageQuerySchema,
  expectedVersionSchema,
  idempotencyKeySchema,
  versionSchema,
} from "../schemas/api-envelope";

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
export type EntityVersion = z.infer<typeof versionSchema>;
export type ExpectedVersion = z.infer<typeof expectedVersionSchema>;
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

// Named by item type for callers; the runtime shape comes from the cursorPage() helper.
export type CursorPage<Item> = { items: Item[]; nextCursor: string | null };
