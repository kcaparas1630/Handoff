import type { EventKind } from "@handoff/contracts";

export type JournalFilter = EventKind | "all";

export type JournalScreenProps = {
  childId: string;
  onOpenEvent: (eventId: string) => void;
  onBack: () => void;
};
