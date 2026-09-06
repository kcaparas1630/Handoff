import type { EventDto, EventKind } from "@handoff/contracts";

export type QuickEntrySheetProps = {
  childId: string;
  /** Kept visible while entering, so an entry cannot be saved against the wrong child. */
  childName: string;
  /** The sheet is mounted per opening, so each entry starts from a blank form. */
  kind: EventKind;
  /** Workspace time zone used by the occurrence control. */
  timezone: string;
  /** The caller's own open care session, recorded with the capture when there is one. */
  careSessionId?: string;
  onSaved: (event: EventDto | null) => void;
  onClose: () => void;
};
