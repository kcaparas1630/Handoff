import type { WorkspaceDto } from "@handoff/contracts";
import type { AppFlavor } from "@handoff/ui";

export type OnboardingScreenProps = {
  flavor: AppFlavor;
  /** Fired once the workspace exists and its first child has been created by the server. */
  onCompleted: (workspaceId: string, childId: string) => void;
};

export type FirstChildStepProps = {
  workspace: WorkspaceDto;
  onCompleted: (workspaceId: string, childId: string) => void;
};
