import type {
  AmountUnit,
  AmountValue,
  EventDetails,
  RevisionOperation,
  RevisionSnapshot,
  TimePrecision,
} from "@handoff/contracts";

export type RevisionForBrief = {
  revisionId: string;
  eventId: string;
  journalSeq: number;
  eventVersion: number;
  operation: RevisionOperation;
  actorDisplayName: string | null;
  createdAt: Date;
  snapshot: RevisionSnapshot;
};

// A revision-backed latest reading that may be older than the change window.
export type LatestKnownFact = {
  eventId: string;
  revisionId: string;
  journalSeq: number;
  createdAt: Date;
  snapshot: RevisionSnapshot;
};

export type LatestKnownFacts = {
  feed?: LatestKnownFact;
  sleep?: LatestKnownFact;
  diaper?: LatestKnownFact;
};

export type BriefBoundary = {
  fromSeqExclusive: number;
  throughSeqInclusive: number;
  initialWindowStart: Date | null;
};

export type RenderBriefInput = {
  revisions: readonly RevisionForBrief[];
  latestKnown: LatestKnownFacts;
  boundary: BriefBoundary;
  pendingCaptureCount: number;
  now: Date;
  timezone: string;
};

export type FactTextFields = {
  occurredAt: Date | null;
  endedAt: Date | null;
  timePrecision: TimePrecision;
  amountValue: AmountValue | null;
  amountUnit: AmountUnit | null;
  details: EventDetails;
  // Used when the occurrence time is unknown, to say when the fact was reported instead.
  reportedAt: Date;
};
