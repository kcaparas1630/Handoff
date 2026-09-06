export type AttachmentViewerProps = {
  /** Ready, published assets only; the ids come from an event or brief entry, never from a guess. */
  assetIds: readonly string[];
  /** Introduces the group, for example "Photos and videos on this update". */
  label?: string | undefined;
  className?: string | undefined;
  testID?: string | undefined;
};

export type AttachmentThumbnailProps = {
  assetId: string;
  positionLabel: string;
  onOpen: () => void;
  testID?: string | undefined;
};

export type AttachmentModalProps = {
  assetId: string;
  onClose: () => void;
};
