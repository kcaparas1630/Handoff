// Timeline paging position. The client treats it as opaque: it encodes the keyset the repository
// orders by, so a caller cannot rewrite it into a scan of another child's rows.
import { Buffer } from "node:buffer";
import { z } from "zod";
import type { EventCursor } from "@handoff/db";

const eventCursorSchema = z.object({
  occurredAt: z.iso.datetime().nullable(),
  id: z.uuid(),
});

export function encodeEventCursor(cursor: EventCursor): string {
  return Buffer.from(
    JSON.stringify({
      occurredAt: cursor.occurredAt === null ? null : cursor.occurredAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

/** Returns null when the value is not a cursor this server issued; the caller reports 422. */
export function decodeEventCursor(encoded: string): EventCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const cursor = eventCursorSchema.safeParse(parsed);
  if (!cursor.success) return null;
  return {
    occurredAt: cursor.data.occurredAt === null ? null : new Date(cursor.data.occurredAt),
    id: cursor.data.id,
  };
}
