import type { AttachmentKind } from "@handoff/contracts";

/** What the caregiver asked the picker for. `any` offers photos and videos in one sheet. */
export type PickAttachmentKind = AttachmentKind | "any";

export type PickAttachmentSource = "library" | "camera";

/**
 * Shown before the system prompt so the reason is stated in the app's own words. Returning false
 * abandons the pick without ever raising an operating-system dialog.
 */
export type ExplainAttachmentPermission = (request: {
  source: PickAttachmentSource;
  /** True when the caregiver already refused once and only Settings can change it. */
  isPermanentlyDenied: boolean;
}) => boolean | Promise<boolean>;

export type PickAttachmentOptions = {
  kind: PickAttachmentKind;
  /** Defaults to the photo library; `camera` is the explicit "Take photo" action. */
  source?: PickAttachmentSource;
  explainPermission?: ExplainAttachmentPermission;
};

/** One chosen file, still exactly as the system handed it over. */
export type PickedAttachment = {
  uri: string;
  kind: AttachmentKind;
  mime: string;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
};

/** A resized, re-encoded JPEG sitting in this app's document storage. */
export type PreparedImage = {
  uri: string;
  mime: "image/jpeg";
  sizeBytes: number;
  width: number;
  height: number;
};

export type StoredAttachmentFile = { uri: string; sizeBytes: number };
