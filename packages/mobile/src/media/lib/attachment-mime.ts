import { IMAGE_MIME_TYPES, VIDEO_MIME_TYPES } from "@handoff/contracts";
import type { AttachmentKind } from "@handoff/contracts";

// The picker reports a MIME type on most devices but not all, so the file name is the fallback.
const extensionMimeTypes: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

const kindExtensions: Readonly<Record<string, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

/** Lower-cased extension including the dot, or null when the path carries none. */
export function attachmentExtensionForUri(uri: string): string | null {
  const withoutQuery = uri.split("?")[0] ?? uri;
  const lastDot = withoutQuery.lastIndexOf(".");
  if (lastDot === -1) return null;
  const extension = withoutQuery.slice(lastDot).toLowerCase();
  return extension.length > 1 ? extension : null;
}

/** The file extension Handoff stores an accepted MIME type under. */
export function attachmentExtensionForMime(mime: string): string | null {
  return kindExtensions[mime.toLowerCase()] ?? null;
}

/**
 * Resolves the content type Handoff will declare. A reported type wins; otherwise the extension
 * decides. Anything outside the accepted lists returns null so it is refused before any upload.
 */
export function attachmentMimeFor(input: {
  kind: AttachmentKind;
  reportedMime?: string | undefined;
  uri: string;
}): string | null {
  const reported = input.reportedMime?.toLowerCase().split(";")[0]?.trim();
  const extension = attachmentExtensionForUri(input.uri);
  const guessed = extension === null ? undefined : extensionMimeTypes[extension];
  const candidate = isAccepted(input.kind, reported) ? reported : guessed;
  return isAccepted(input.kind, candidate) ? candidate : null;
}

function isAccepted(kind: AttachmentKind, mime: string | undefined): mime is string {
  if (mime === undefined) return false;
  const accepted: readonly string[] = kind === "image" ? IMAGE_MIME_TYPES : VIDEO_MIME_TYPES;
  return accepted.includes(mime);
}
