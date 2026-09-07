import { useDeleteChild } from "@handoff/api-client";
import { Button, StatusMessage } from "@handoff/ui";
import { useState } from "react";

import { describeError } from "../shared/lib/describe-error";
import { DangerConfirmation } from "./DangerConfirmation";
import type { DeleteChildSectionProps } from "./types/privacy-settings-screen";

const consequences = [
  "Every entry, correction, and handoff brief for this child is removed.",
  "Recordings, photos, and videos attached to those entries are deleted from storage.",
  "Everyone who could see this child loses access, including the families you invited.",
  "Our transcription and AI providers keep their own copies for their own retention periods.",
  "This cannot be undone, and there is no restore from within the app.",
];

/**
 * Owner-only in the UI; the server checks the same thing. The endpoint answers 202 because purging
 * objects and revisions is a durable job, so this reports work in progress rather than completion.
 */
export function DeleteChildSection({ childId, childName, onDeleted }: DeleteChildSectionProps) {
  const deleteChild = useDeleteChild(childId);
  const [isAccepted, setIsAccepted] = useState(false);

  // The purge is a background job, so this reports that it started and then leaves the child's
  // screens rather than pretending the deletion has already finished.
  if (isAccepted) {
    return (
      <>
        <StatusMessage
          tone="info"
          message={`Deleting ${childName}. This can take a few minutes, and the record disappears as each part is removed.`}
          testID="delete-child-accepted"
        />
        <Button label="Back to your children" onPress={onDeleted} testID="delete-child-done" />
      </>
    );
  }

  return (
    <DangerConfirmation
      armLabel={`Delete ${childName}`}
      heading={`Deleting ${childName} removes:`}
      consequences={consequences}
      confirmPhrase={childName}
      confirmPhraseLabel="Type the child's name to confirm"
      confirmLabel={`Delete ${childName} permanently`}
      isBusy={deleteChild.isPending}
      errorMessage={deleteChild.isError ? describeError(deleteChild.error) : null}
      onConfirm={() =>
        deleteChild.mutate(undefined, {
          onSuccess: () => setIsAccepted(true),
        })
      }
      testIDPrefix="delete-child"
    />
  );
}
