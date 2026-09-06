import type {
  AmountUnit,
  AmountValue,
  CaptureAmbiguity,
  EventDetails,
  EventKind,
  TimePrecision,
} from "@handoff/contracts";

// Times arrive as Date because the rules compare instants; the transport keeps ISO strings.
export type EventSemanticsInput = {
  kind: EventKind;
  occurredAt: Date | null;
  endedAt: Date | null;
  timePrecision: TimePrecision;
  amountValue: AmountValue | null;
  amountUnit: AmountUnit | null;
  details: EventDetails;
};

export type EventFieldError = {
  field: string;
  message: string;
};

export type EventSemanticsResult = { ok: true } | { ok: false; errors: EventFieldError[] };

// The parts of a reviewed candidate that decide whether it describes care that happened.
export type CandidateFact = {
  kind: EventKind;
  details: EventDetails;
  ambiguities: readonly CaptureAmbiguity[];
  discarded: boolean;
};
