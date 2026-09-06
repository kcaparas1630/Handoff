import { useAssetRead } from "@handoff/api-client";
import { AttachmentStrip, AttachmentTile } from "@handoff/ui";
import type { AttachmentTileStatus } from "@handoff/ui";
import { useState } from "react";

import { AttachmentModal } from "./AttachmentModal";
import type { AttachmentThumbnailProps, AttachmentViewerProps } from "./types/attachment-viewer";

const maxTiles = 3;

/**
 * Published attachments on one journal entry. Each tile asks for its own short-lived read URL only
 * when it is on screen; the URL lives in the query cache keyed by the signed-in user and is never
 * written to disk, so signing out or switching account cannot reveal it (architecture.md 6 and 7).
 */
export function AttachmentViewer({
  assetIds,
  label = "Photos and videos",
  className,
  testID,
}: AttachmentViewerProps) {
  const [openAssetId, setOpenAssetId] = useState<string | null>(null);
  if (assetIds.length === 0) return null;

  return (
    <>
      <AttachmentStrip label={label} className={className} testID={testID}>
        {assetIds.slice(0, maxTiles).map((assetId, index) => (
          <AttachmentThumbnail
            key={assetId}
            assetId={assetId}
            positionLabel={`Attachment ${index + 1} of ${Math.min(assetIds.length, maxTiles)}`}
            onOpen={() => setOpenAssetId(assetId)}
            testID={`attachment-${assetId}`}
          />
        ))}
      </AttachmentStrip>

      {openAssetId === null ? null : (
        <AttachmentModal assetId={openAssetId} onClose={() => setOpenAssetId(null)} />
      )}
    </>
  );
}

function AttachmentThumbnail({ assetId, positionLabel, onOpen, testID }: AttachmentThumbnailProps) {
  const asset = useAssetRead(assetId);

  return (
    <AttachmentTile
      status={thumbnailStatus(asset)}
      positionLabel={positionLabel}
      onPress={onOpen}
      onRetry={() => void asset.refetch()}
      testID={testID}
    />
  );
}

/** A broken image icon is never the answer: every outcome names itself in words. */
function thumbnailStatus(asset: ReturnType<typeof useAssetRead>): AttachmentTileStatus {
  const kind = asset.data?.asset.kind === "video" ? "video" : "image";
  if (asset.data !== undefined) return { state: "ready", kind, uri: asset.data.url };
  if (asset.isError) return { state: "failed", kind, message: "could not load; try again" };
  return { state: "loading", kind };
}
