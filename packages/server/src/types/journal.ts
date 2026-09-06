import type {
  AmountUnit,
  AmountValue,
  EventDetails,
  EventKind,
  EventStatus,
  TimePrecision,
} from "@handoff/contracts";

/**
 * The canonical values of one event, independent of where they came from: a reviewed candidate,
 * a stored row, or a correction patch. The DTO, the revision snapshot, and the semantic rules
 * are all derived from this one shape so they can never disagree.
 */
export interface EventFacts {
  kind: EventKind;
  occurredAt: Date | null;
  endedAt: Date | null;
  timezone: string;
  timePrecision: TimePrecision;
  amountValue: AmountValue | null;
  amountUnit: AmountUnit | null;
  details: EventDetails;
  important: boolean;
  status: EventStatus;
}
