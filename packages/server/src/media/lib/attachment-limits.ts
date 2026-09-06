// The product limits of architecture §6, indexed by attachment kind. The contract exports them as
// separate constants because the client checks one kind at a time; the server checks whichever
// kind the request named, so it needs them as a table.
import {
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_DURATION_MS,
  VIDEO_MIME_TYPES,
} from "@handoff/contracts";
import type { AttachmentKind } from "@handoff/contracts";
import type { MediaKind } from "@handoff/db";

export interface AttachmentLimits {
  mimeTypes: readonly string[];
  maxBytes: number;
  /** Null for images, which have no duration to exceed. */
  maxDurationMs: number | null;
  /** What a caregiver is told when the file is over the limit. */
  sizeMessage: string;
}

export const IMAGE_LIMITS: AttachmentLimits = {
  mimeTypes: IMAGE_MIME_TYPES,
  maxBytes: IMAGE_MAX_BYTES,
  maxDurationMs: null,
  sizeMessage: "A photo may be at most 5 MB",
};

export const VIDEO_LIMITS: AttachmentLimits = {
  mimeTypes: VIDEO_MIME_TYPES,
  maxBytes: VIDEO_MAX_BYTES,
  maxDurationMs: VIDEO_MAX_DURATION_MS,
  sizeMessage: "A video may be at most 20 MB",
};

export function attachmentLimitsFor(kind: AttachmentKind): AttachmentLimits {
  return kind === "image" ? IMAGE_LIMITS : VIDEO_LIMITS;
}

/** Audio is not an attachment; a stored row of that kind never reaches these limits. */
export function attachmentLimitsForAsset(kind: MediaKind): AttachmentLimits {
  if (kind === "audio") throw new Error("audio is not an attachment kind");
  return attachmentLimitsFor(kind);
}
