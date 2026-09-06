import type { BriefEntry } from "@handoff/contracts";

export type HandoffScreenProps = {
  childId: string;
  onDone: () => void;
  onOpenEvent: (eventId: string) => void;
};

export type BriefEntryRowProps = {
  entry: BriefEntry;
  /** Workspace time zone; the brief carries instants, not wall times. */
  timezone: string;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenEvent: (eventId: string) => void;
};
