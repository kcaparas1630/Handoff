import { useAssetRead } from "@handoff/api-client";
import { Button, StatusMessage } from "@handoff/ui";
import { VideoView, useVideoPlayer } from "expo-video";
import { Image, Modal, View } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import type { AttachmentModalProps } from "./types/attachment-viewer";

/**
 * One attachment at full size. Mounting refetches a read URL that has passed its expiry, so a
 * viewer reopened minutes later plays from a fresh authorization rather than a dead link.
 */
export function AttachmentModal({ assetId, onClose }: AttachmentModalProps) {
  const asset = useAssetRead(assetId);
  const url = asset.data?.url ?? null;
  const kind = asset.data?.asset.kind ?? null;

  return (
    <Modal
      visible
      animationType="fade"
      transparent={false}
      onRequestClose={onClose}
      supportedOrientations={["portrait", "landscape"]}
    >
      <View className="flex-1 justify-center gap-lg bg-background p-lg dark:bg-background-dark">
        {asset.isPending ? <StatusMessage tone="info" message="Loading this attachment…" /> : null}

        {asset.isError ? (
          <>
            <StatusMessage
              tone="error"
              message={`Could not load; try again. ${describeError(asset.error)}`}
            />
            <Button
              label="Try again"
              onPress={() => void asset.refetch()}
              isLoading={asset.isFetching}
              testID="attachment-modal-retry"
            />
          </>
        ) : null}

        {url === null || kind === null ? null : kind === "video" ? (
          <AttachmentVideo url={url} />
        ) : (
          <Image
            accessibilityIgnoresInvertColors
            accessibilityLabel="Photo attached to this update"
            source={{ uri: url }}
            resizeMode="contain"
            className="flex-1 w-full"
          />
        )}

        <Button
          label="Close"
          variant="secondary"
          onPress={onClose}
          testID="attachment-modal-close"
        />
      </View>
    </Modal>
  );
}

// A separate component so the player is created only once a URL exists, and released on close.
function AttachmentVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url);

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      accessibilityLabel="Video attached to this update"
      style={{ flex: 1, width: "100%" }}
      testID="attachment-modal-video"
    />
  );
}
