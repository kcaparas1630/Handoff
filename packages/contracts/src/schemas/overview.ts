import { z } from "zod";
import { careSessionDtoSchema } from "./care";
import { childDtoSchema } from "./children";
import {
  amountUnitSchema,
  amountValueSchema,
  eventDetailsSchema,
  eventDtoSchema,
  timePrecisionSchema,
} from "./events";
import { contextFactKindSchema } from "./handoffs";

// A latest-known confirmed reading, resolved across the whole journal rather than the first page.
export const latestFactSchema = z.object({
  eventId: z.uuid(),
  revisionId: z.uuid(),
  kind: contextFactKindSchema,
  occurredAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  timePrecision: timePrecisionSchema,
  amountValue: amountValueSchema.nullable(),
  amountUnit: amountUnitSchema.nullable(),
  details: eventDetailsSchema,
  text: z.string(),
});

// A live read-only projection. It never advances a handoff cursor and is not an acknowledgement.
export const overviewDtoSchema = z.object({
  child: childDtoSchema,
  latest: z.object({
    feed: latestFactSchema.nullable(),
    sleep: latestFactSchema.nullable(),
    diaper: latestFactSchema.nullable(),
  }),
  // Reported without an occurrence time, so they cannot be ranked as the latest care.
  recentUnknownTime: z.array(latestFactSchema),
  recentActivity: z.array(eventDtoSchema).max(5),
  activeSessions: z.array(careSessionDtoSchema),
  // Caller-specific: unacknowledged published changes for this child.
  unreadChangeCount: z.int().nonnegative(),
  pendingCaptureCount: z.int().nonnegative(),
  generatedAt: z.iso.datetime(),
});
