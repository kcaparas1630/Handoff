import type { AppFlavor } from "@handoff/ui";

export type InvitationsScreenProps = {
  flavor: AppFlavor;
  workspaceId: string;
  onBack: () => void;
};

export type InviteFormProps = {
  flavor: AppFlavor;
  workspaceId: string;
};
