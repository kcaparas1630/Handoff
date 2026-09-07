import { useApiUserId } from "@handoff/api-client";
import {
  deleteAllForUser,
  describeAttachmentProgress,
  openOutbox,
  useOutboxAttachments,
  useOutboxCaptures,
  useRecordingStore,
} from "@handoff/mobile";
import { StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { Text, View } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import { DangerConfirmation } from "./DangerConfirmation";

const confirmPhrase = "delete files";

/**
 * What this phone still holds, and a way to throw it away. Rows only exist while the server has
 * not acknowledged the file, so everything counted here would otherwise still be uploaded.
 */
export function LocalFilesSection() {
  const clerkUserId = useApiUserId();
  const recordings = useOutboxCaptures();
  const attachments = useOutboxAttachments();
  const requestOutboxSync = useRecordingStore((state) => state.requestOutboxSync);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ recordings: number; attachments: number } | null>(null);

  const attachmentLine = describeAttachmentProgress(attachments.summary);
  const total = recordings.length + attachments.summary.localCount;

  function deleteLocalFiles(): void {
    if (clerkUserId === null) return;
    setIsBusy(true);
    setErrorMessage(null);
    void openOutbox()
      .then((db) => deleteAllForUser(db, clerkUserId))
      .then((counts) => {
        setRemoved(counts);
        requestOutboxSync();
      })
      .catch((error: unknown) => setErrorMessage(describeError(error)))
      .finally(() => setIsBusy(false));
  }

  return (
    <View className="gap-md" testID="local-files-section">
      <Text className="text-base text-primary dark:text-primary-dark">
        {total === 0
          ? "Nothing is waiting on this phone. Every recording and file you made has reached Handoff."
          : describeRecordings(recordings.length)}
      </Text>
      {attachmentLine === null ? null : (
        <Text className="text-base text-primary dark:text-primary-dark">{attachmentLine}</Text>
      )}

      {removed === null ? null : (
        <StatusMessage
          tone="success"
          message={`Deleted ${String(removed.recordings)} recording${removed.recordings === 1 ? "" : "s"} and ${String(removed.attachments)} attached file${removed.attachments === 1 ? "" : "s"} from this phone.`}
          testID="local-files-deleted"
        />
      )}

      {total === 0 ? null : (
        <DangerConfirmation
          armLabel="Delete these files from this phone"
          heading="Deleting the files on this phone means:"
          consequences={[
            "Recordings that were never sent are gone; nobody else ever received them.",
            "Anything Handoff already accepted stays in the journal and is not affected.",
            "There is no copy on this phone afterwards.",
          ]}
          confirmPhrase={confirmPhrase}
          confirmPhraseLabel={`Type "${confirmPhrase}" to confirm`}
          confirmLabel="Delete the local files"
          isBusy={isBusy}
          errorMessage={errorMessage}
          onConfirm={deleteLocalFiles}
          testIDPrefix="local-files"
        />
      )}
    </View>
  );
}

function describeRecordings(count: number): string {
  if (count === 0) return "No recordings are waiting on this phone.";
  const noun = count === 1 ? "recording is" : "recordings are";
  return `${String(count)} ${noun} still on this phone and not shared yet.`;
}
