import type { AppFlavor } from "@handoff/ui";

export type CareDashboardScreenProps = {
  childId: string;
  flavor: AppFlavor;
  onOpenHandoff: (childId: string) => void;
  onOpenJournal: (childId: string) => void;
  onOpenEvent: (eventId: string) => void;
  onOpenProfile: (childId: string) => void;
};

export type DashboardHeaderProps = {
  childName: string;
  workspaceName: string;
  /** "Alex is caring" or the plain statement that nobody declared care. */
  caringLine: string;
  /** "last synced 09:05", or the plain absence of a sync time. */
  lastSyncedLine: string;
  onOpenProfile: () => void;
};
