import type { AppFlavor } from "@handoff/ui";

export type ChildListScreenProps = {
  flavor: AppFlavor;
  onSelectChild: (childId: string) => void;
  onAddChild: () => void;
  onInvite: () => void;
  /** Fired when the signed-in user belongs to no workspace yet. */
  onNeedsOnboarding: () => void;
};
