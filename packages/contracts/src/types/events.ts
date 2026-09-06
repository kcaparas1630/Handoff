import type { z } from "zod";
import type {
  amountUnitSchema,
  amountValueSchema,
  deleteEventRequestSchema,
  diaperContentsSchema,
  eventDetailsSchema,
  eventDtoSchema,
  eventKindSchema,
  eventPayloadSchema,
  eventStatusSchema,
  eventsListQuerySchema,
  feedMethodSchema,
  noteIntentSchema,
  revisionEventSchema,
  revisionOperationSchema,
  revisionSnapshotSchema,
  sleepStateSchema,
  timePrecisionSchema,
  updateEventRequestSchema,
} from "../schemas/events";

export type EventKind = z.infer<typeof eventKindSchema>;
export type TimePrecision = z.infer<typeof timePrecisionSchema>;
export type AmountUnit = z.infer<typeof amountUnitSchema>;
export type AmountValue = z.infer<typeof amountValueSchema>;
export type EventStatus = z.infer<typeof eventStatusSchema>;
export type RevisionOperation = z.infer<typeof revisionOperationSchema>;

export type FeedMethod = z.infer<typeof feedMethodSchema>;
export type DiaperContents = z.infer<typeof diaperContentsSchema>;
export type SleepState = z.infer<typeof sleepStateSchema>;
export type NoteIntent = z.infer<typeof noteIntentSchema>;
export type EventDetails = z.infer<typeof eventDetailsSchema>;
export type EventPayload = z.infer<typeof eventPayloadSchema>;

export type EventDto = z.infer<typeof eventDtoSchema>;
export type UpdateEventRequest = z.infer<typeof updateEventRequestSchema>;
export type DeleteEventRequest = z.infer<typeof deleteEventRequestSchema>;
export type EventsListQuery = z.infer<typeof eventsListQuerySchema>;
export type RevisionEvent = z.infer<typeof revisionEventSchema>;
export type RevisionSnapshot = z.infer<typeof revisionSnapshotSchema>;
