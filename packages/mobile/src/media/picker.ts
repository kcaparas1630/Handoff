import {
  getCameraPermissionsAsync,
  getMediaLibraryPermissionsAsync,
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
  requestMediaLibraryPermissionsAsync,
} from "expo-image-picker";
import type { ImagePickerAsset, ImagePickerOptions, MediaType } from "expo-image-picker";
import { VIDEO_MAX_DURATION_MS } from "@handoff/contracts";
import type { AttachmentKind } from "@handoff/contracts";
import { File } from "expo-file-system";

import { attachmentMimeFor } from "./lib/attachment-mime";
import type {
  PickAttachmentKind,
  PickAttachmentOptions,
  PickAttachmentSource,
  PickedAttachment,
} from "./types/attachment";

/**
 * Attachment selection. Nothing here runs on its own: `pickAttachment` is only ever reached from
 * an explicit "Add photo or video" or "Take photo" tap, and permission is requested at that point
 * rather than on app start (AGENTS.md, mobile experience).
 */

/** Raised when the caregiver refused access; the caller offers a Settings link instead. */
export class AttachmentPermissionError extends Error {
  readonly source: PickAttachmentSource;
  /** True when only the system settings screen can change the answer. */
  readonly isPermanentlyDenied: boolean;

  constructor(source: PickAttachmentSource, isPermanentlyDenied: boolean) {
    super(
      source === "camera"
        ? "Handoff needs camera access to take a photo."
        : "Handoff needs access to your photos to attach one.",
    );
    this.name = "AttachmentPermissionError";
    this.source = source;
    this.isPermanentlyDenied = isPermanentlyDenied;
  }
}

/** Raised when the chosen file is a container Handoff would not be allowed to upload. */
export class UnsupportedAttachmentError extends Error {
  constructor(kind: AttachmentKind) {
    super(
      kind === "video"
        ? "This device produced a video format Handoff cannot send."
        : "This device produced an image format Handoff cannot send.",
    );
    this.name = "UnsupportedAttachmentError";
  }
}

const mediaTypesFor: Readonly<Record<PickAttachmentKind, MediaType[]>> = {
  image: ["images"],
  video: ["videos"],
  any: ["images", "videos"],
};

/**
 * Opens the system picker or camera and returns the chosen file, or null when the caregiver backed
 * out. Nothing is resized, copied, or enqueued here.
 */
export async function pickAttachment(
  options: PickAttachmentOptions,
): Promise<PickedAttachment | null> {
  const source = options.source ?? "library";
  const granted = await ensurePermission(source, options);
  if (!granted) return null;

  const pickerOptions: ImagePickerOptions = {
    mediaTypes: mediaTypesFor[options.kind],
    // The picture is re-encoded before upload, so the picker keeps close to the original here.
    quality: 0.9,
    // A recorded clip is cut at the product limit rather than rejected afterwards.
    videoMaxDuration: VIDEO_MAX_DURATION_MS / 1000,
    // architecture.md section 6: image location metadata never leaves the device.
    exif: false,
    allowsMultipleSelection: false,
    selectionLimit: 1,
  };

  const result =
    source === "camera"
      ? await launchCameraAsync(pickerOptions)
      : await launchImageLibraryAsync(pickerOptions);
  if (result.canceled) return null;

  const asset = result.assets[0];
  if (asset === undefined) return null;
  return toPickedAttachment(asset);
}

async function ensurePermission(
  source: PickAttachmentSource,
  options: PickAttachmentOptions,
): Promise<boolean> {
  const current =
    source === "camera"
      ? await getCameraPermissionsAsync()
      : await getMediaLibraryPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) throw new AttachmentPermissionError(source, true);

  // The reason is explained in the app's own words before the system dialog appears.
  const proceed =
    (await options.explainPermission?.({ source, isPermanentlyDenied: false })) ?? true;
  if (!proceed) return false;

  const response =
    source === "camera"
      ? await requestCameraPermissionsAsync()
      : await requestMediaLibraryPermissionsAsync();
  if (response.granted) return true;
  throw new AttachmentPermissionError(source, !response.canAskAgain);
}

function toPickedAttachment(asset: ImagePickerAsset): PickedAttachment {
  const kind: AttachmentKind = asset.type === "video" ? "video" : "image";
  const mime = attachmentMimeFor({ kind, reportedMime: asset.mimeType, uri: asset.uri });
  if (mime === null) throw new UnsupportedAttachmentError(kind);

  // Some Android providers omit the size; the file itself is then the only source of truth.
  const sizeBytes = asset.fileSize ?? new File(asset.uri).size;
  const durationMs = asset.duration ?? undefined;

  return {
    uri: asset.uri,
    kind,
    mime,
    sizeBytes,
    ...(durationMs === undefined ? {} : { durationMs: Math.round(durationMs) }),
    ...(asset.width > 0 ? { width: asset.width } : {}),
    ...(asset.height > 0 ? { height: asset.height } : {}),
  };
}
