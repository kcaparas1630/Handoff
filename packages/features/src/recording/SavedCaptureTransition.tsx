import { Button, Screen, StatusMessage } from "@handoff/ui";
import { Text } from "react-native";

import { AttachmentPicker } from "./AttachmentPicker";
import type { SavedCaptureTransitionProps } from "./types/review";

/**
 * The quiet transition after Save (experience-design.md section 3). The entries are already in the
 * journal; this only offers to add a photo or video before moving on.
 */
export function SavedCaptureTransition({
  events,
  captureId,
  childId,
  workspaceId,
  onDone,
}: SavedCaptureTransitionProps) {
  const publishedCount = events.reduce((total, event) => total + event.readyAssetIds.length, 0);

  return (
    <Screen scroll testID="review-saved">
      <StatusMessage
        tone="success"
        message={`Saved ${events.length} update${events.length === 1 ? "" : "s"} to the journal.`}
      />
      <Text className="text-base text-muted dark:text-muted-dark">
        Want to add a photo or video to this update? You can also do it later from the entry.
      </Text>

      {captureId === null || childId === null || workspaceId === null ? null : (
        <AttachmentPicker
          captureId={captureId}
          childId={childId}
          workspaceId={workspaceId}
          serverAttachmentCount={publishedCount}
          testID="saved-attachments"
        />
      )}

      <Button label="Done" onPress={onDone} testID="review-saved-done" />
    </Screen>
  );
}
