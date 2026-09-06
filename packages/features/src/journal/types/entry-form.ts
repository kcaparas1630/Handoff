import type {
  AmountUnit,
  DiaperContents,
  EventDetails,
  EventKind,
  FeedMethod,
  NoteIntent,
  SleepState,
  TimePrecision,
} from "@handoff/contracts";

export type OccurrenceChoice = "now" | "earlier" | "unknown";

export type OccurrenceTime = {
  /** Null until the caregiver picks one. Nothing is preselected, so no time is ever invented. */
  choice: OccurrenceChoice | null;
  /** The chosen instant; null for "time unknown" and while no choice has been made. */
  instant: Date | null;
};

export type FeedFormFields = {
  method: FeedMethod;
  /** Free text so an empty amount stays unrecorded instead of becoming zero. */
  amountText: string;
  amountUnit: AmountUnit | null;
  description: string;
};

export type DiaperFormFields = {
  contents: DiaperContents | null;
  quantity: string;
  note: string;
};

export type SleepFormFields = {
  state: SleepState | null;
  note: string;
};

export type MilestoneFormFields = {
  description: string;
  quote: string;
  /** The caregiver's report that this was a first, not an independently established fact. */
  reportedFirst: boolean;
};

export type NoteFormFields = {
  text: string;
  intent: NoteIntent | null;
};

/**
 * One form state covering every kind. The sheet renders only the slice for the kind being saved,
 * and the untouched slices never reach the request.
 */
export type EntryForm = {
  occurrence: OccurrenceTime;
  /** Sleep intervals only; ignored for every other kind and state. */
  endOccurrence: OccurrenceTime;
  important: boolean;
  feed: FeedFormFields;
  diaper: DiaperFormFields;
  sleep: SleepFormFields;
  milestone: MilestoneFormFields;
  note: NoteFormFields;
};

/** The canonical event fields a validated form produces, shared by quick entry and the editor. */
export type EntryFields = {
  kind: EventKind;
  occurredAt: Date | null;
  endedAt: Date | null;
  timePrecision: TimePrecision;
  amountValue: string | null;
  amountUnit: AmountUnit | null;
  details: EventDetails;
  important: boolean;
};
