import type { ReactNode } from "react";

export type AttachmentTileKind = "image" | "video";

/**
 * What the tile is honestly able to say about one attachment. Nothing renders as a picture until
 * the server has validated it and issued a read URL (architecture.md section 6).
 */
export type AttachmentTileStatus =
  /** The file is in this app's storage and has not reached the server. */
  | { state: "local"; kind: AttachmentTileKind }
  /** The server has the bytes but has not published them yet. */
  | { state: "pending"; kind: AttachmentTileKind }
  /** A read URL is being requested; the bytes themselves are known to exist. */
  | { state: "loading"; kind: AttachmentTileKind }
  | { state: "ready"; kind: AttachmentTileKind; uri: string }
  | { state: "failed"; kind: AttachmentTileKind; message: string };

export type AttachmentTileProps = {
  status: AttachmentTileStatus;
  /** Names this tile for a screen reader, for example "Photo 1 of 3". */
  positionLabel: string;
  onPress?: (() => void) | undefined;
  /** Offered on `failed`; the label is fixed so the action reads the same everywhere. */
  onRetry?: (() => void) | undefined;
  testID?: string | undefined;
};

export type AttachmentStripProps = {
  /** Attachment tiles. At most three are laid out, matching the per-capture limit. */
  children: ReactNode;
  /** Introduces the group, for example "Photos and videos on this update". */
  label: string;
  className?: string | undefined;
  testID?: string | undefined;
};
