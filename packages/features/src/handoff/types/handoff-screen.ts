import type { BriefEntry } from "@handoff/contracts";

export type HandoffScreenProps = {
  childId: string;
  onDone: () => void;
  onOpenEvent: (eventId: string) => void;
};

export type BriefEntryRowProps = {
  entry: BriefEntry;
  /**
   * The attachments this row should draw. The brief shows a shared attachment once per section
   * (experience-design.md section 5), so the parent decides which entry represents its capture.
   */
  assetIds: readonly string[];
  /** Workspace time zone; the brief carries instants, not wall times. */
  timezone: string;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenEvent: (eventId: string) => void;
};
