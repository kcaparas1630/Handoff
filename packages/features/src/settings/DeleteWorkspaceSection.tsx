import { useDeleteWorkspace } from "@handoff/api-client";
import { Button, StatusMessage } from "@handoff/ui";
import { useState } from "react";

import { describeError } from "../shared/lib/describe-error";
import { DangerConfirmation } from "./DangerConfirmation";
import type { DeleteWorkspaceSectionProps } from "./types/privacy-settings-screen";

const consequences = [
  "Every child in this workspace is deleted, not just yours.",
  "Every entry, brief, recording, photo, and video belonging to those children is removed.",
  "Every staff member and family loses access, and open invitations stop working.",
  "Our transcription and AI providers keep their own copies for their own retention periods.",
  "This cannot be undone, and there is no restore from within the app.",
];

/** Owner-only, and deliberately harder to reach than child deletion: it ends other people's access. */
export function DeleteWorkspaceSection({
  workspaceId,
  workspaceName,
  onDeleted,
}: DeleteWorkspaceSectionProps) {
  const deleteWorkspace = useDeleteWorkspace(workspaceId);
  const [isAccepted, setIsAccepted] = useState(false);

  if (isAccepted) {
    return (
      <>
        <StatusMessage
          tone="info"
          message={`Deleting ${workspaceName}. This can take a few minutes, and everyone loses access as it runs.`}
          testID="delete-workspace-accepted"
        />
        <Button label="Back to your children" onPress={onDeleted} testID="delete-workspace-done" />
      </>
    );
  }

  return (
    <DangerConfirmation
      armLabel={`Delete ${workspaceName}`}
      heading={`Deleting ${workspaceName} removes:`}
      consequences={consequences}
      requiresAcknowledgement
      acknowledgementLabel="I understand this deletes everyone's records here"
      confirmPhrase={workspaceName}
      confirmPhraseLabel="Type the workspace name to confirm"
      confirmLabel={`Delete ${workspaceName} permanently`}
      isBusy={deleteWorkspace.isPending}
      errorMessage={deleteWorkspace.isError ? describeError(deleteWorkspace.error) : null}
      onConfirm={() =>
        deleteWorkspace.mutate(undefined, {
          onSuccess: () => setIsAccepted(true),
        })
      }
      testIDPrefix="delete-workspace"
    />
  );
}
