import {
  describeAttachmentProgress,
  openOutbox,
  restartOutboxAttachment,
  summariseAttachments,
  useOutboxAttachments,
} from "@handoff/mobile";
import { AttachmentStrip, AttachmentTile, Button, StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { Linking, Text, View } from "react-native";

import { describeAttachmentLimit, remainingAttachmentSlots } from "./lib/attachment-limits";
import { attachmentTileStatus } from "./lib/attachment-state";
import { useAddAttachment } from "./useAddAttachment";
import type { AttachmentPickerProps } from "./types/attachment-picker";

/**
 * The secondary "Add photo or video" action on a capture. Attachments may be added while a
 * recording is being reviewed, straight after saving it, and later from a confirmed entry
 * (architecture.md section 6). Nothing opens until the caregiver taps.
 */
export function AttachmentPicker({
  captureId,
  childId,
  workspaceId,
  serverAttachmentCount,
  className = "",
  testID,
}: AttachmentPickerProps) {
  const outbox = useOutboxAttachments(captureId);
  const [isChoosing, setIsChoosing] = useState(false);
  const add = useAddAttachment({
    captureId: captureId ?? "",
    childId,
    workspaceId,
    onQueued: () => {
      setIsChoosing(false);
      outbox.refresh();
    },
  });

  // The hook reads every capture when given null, which is not what an unallocated capture means.
  const rows = captureId === null ? [] : outbox.rows;
  const summary = summariseAttachments(rows);
  const remaining = remainingAttachmentSlots(summary.localCount, serverAttachmentCount);
  const progressLine = describeAttachmentProgress(summary);
  const canAdd = captureId !== null && remaining > 0 && !add.isWorking;

  function retry(localId: string): void {
    void openOutbox()
      .then((db) => restartOutboxAttachment(db, localId, crypto.randomUUID()))
      .then(outbox.refresh);
  }

  return (
    <View className={`gap-md ${className}`} testID={testID}>
      <AttachmentStrip label="Files you added to this update">
        {rows.map((row, index) => (
          <AttachmentTile
            key={row.localId}
            status={attachmentTileStatus(row)}
            positionLabel={`Added file ${index + 1} of ${rows.length}`}
            onRetry={row.stage === "failed" ? () => retry(row.localId) : undefined}
            testID={`attachment-local-${row.localId}`}
          />
        ))}
      </AttachmentStrip>

      {isChoosing ? (
        <View className="gap-sm">
          <Button
            label="Choose from library"
            variant="secondary"
            onPress={() => void add.addAttachment("library")}
            isLoading={add.isWorking}
            testID="attachment-pick-library"
          />
          <Button
            label="Take photo"
            variant="secondary"
            onPress={() => void add.addAttachment("camera")}
            isLoading={add.isWorking}
            testID="attachment-pick-camera"
          />
          <Button label="Not now" variant="quiet" onPress={() => setIsChoosing(false)} />
        </View>
      ) : (
        <Button
          label="Add photo or video"
          variant="secondary"
          onPress={() => {
            add.clearFailure();
            setIsChoosing(true);
          }}
          isDisabled={!canAdd}
          accessibilityHint={
            captureId === null
              ? "Available once this update reaches Handoff"
              : "Opens your photos or the camera"
          }
          testID="attachment-add"
        />
      )}

      <Text className="text-sm text-muted dark:text-muted-dark">
        {captureId === null
          ? "You can add a photo or video once this update reaches Handoff."
          : describeAttachmentLimit(remaining)}
      </Text>

      {/* Says in words which files are still on this phone and which are waiting for checks. */}
      {progressLine === null ? null : (
        <Text className="text-sm text-muted dark:text-muted-dark" testID="attachment-progress">
          {progressLine}
        </Text>
      )}

      {add.failure === null ? null : (
        <>
          <StatusMessage tone="warning" message={add.failure.message} />
          {add.failure.needsSettings ? (
            <Button
              label="Open settings"
              variant="secondary"
              onPress={() => void Linking.openSettings()}
              testID="attachment-open-settings"
            />
          ) : null}
        </>
      )}
    </View>
  );
}
