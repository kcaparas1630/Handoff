import type { TimePrecision } from "@handoff/contracts";

export type Meridiem = "am" | "pm";

// What the caregiver said, before any calendar decision is made for them.
export type SpokenTime = {
  hour?: number;
  minute?: number;
  meridiem?: Meridiem;
  // -1 is an explicit "yesterday"; omitting it means the day was never stated.
  dayOffset?: 0 | -1;
  isNow?: boolean;
};

export type TimeAmbiguity = "date_unknown" | "am_pm_unknown" | "dst_ambiguous";

export type ResolveEventTimeInput = {
  spokenTime: SpokenTime | null;
  capturedAt: Date;
  timezone: string;
};

// proposedDates holds every reading worth offering, most recent past first. occurredAt is the
// first proposal, which the user must still confirm before the event is saved.
export type ResolvedEventTime = {
  occurredAt: Date | null;
  timePrecision: TimePrecision;
  ambiguities: TimeAmbiguity[];
  proposedDates: Date[];
};
