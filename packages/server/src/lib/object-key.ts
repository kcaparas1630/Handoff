// Object keys are generated here and nowhere else. A client never supplies a storage path
// (architecture §6): the key is `workspaceId/childId/captureId/assetId.ext`, all server ids.
import { AUDIO_MIME_TYPES, IMAGE_MIME_TYPES, VIDEO_MIME_TYPES } from "@handoff/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The allowlist is keyed by MIME so the stored name says what the bytes claim to be. Two MIME
// types can share one extension; nothing here reads the client's filename.
const extensionByMime: Record<string, string> = {
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** Every product-allowed MIME type must have an extension, or an upload cannot be allocated. */
const allowedMimeTypes: readonly string[] = [
  ...AUDIO_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
  ...VIDEO_MIME_TYPES,
];

export function objectExtensionForMime(mime: string): string | null {
  if (!allowedMimeTypes.includes(mime)) return null;
  return extensionByMime[mime] ?? null;
}

export interface ObjectKeyParts {
  workspaceId: string;
  childId: string;
  captureId: string;
  assetId: string;
  mime: string;
}

/**
 * Throws rather than returning a fallback: an unparsable id or an unknown MIME type here would
 * mean the caller skipped validation, and a guessed key can address another tenant's object.
 */
export function buildObjectKey(parts: ObjectKeyParts): string {
  const extension = objectExtensionForMime(parts.mime);
  if (extension === null) throw new Error("no object extension is allowed for that content type");
  return `${assetPathPrefix(parts)}.${extension}`;
}

/**
 * Where the normalized copy of a photo is published. It is deliberately a different key from the
 * raw upload, which may already end in `.jpg`: the worker writes the normalized object, publishes
 * it, and only then deletes the raw one, so a crash in between leaves the source readable.
 */
export function buildNormalizedImageKey(parts: Omit<ObjectKeyParts, "mime">): string {
  return `${assetPathPrefix(parts)}.normalized.jpg`;
}

/** Every object belonging to one workspace lives under this prefix, which cleanup reconciles. */
export function workspaceObjectPrefix(workspaceId: string): string {
  if (!UUID.test(workspaceId)) throw new Error("object key parts must be UUIDs");
  return `${workspaceId}/`;
}

/**
 * The asset id a key was generated for, or null for a key this server did not build. Cleanup uses
 * it to tell an orphaned object from one whose row simply has not been read yet.
 */
export function assetIdFromObjectKey(objectKey: string): string | null {
  const segments = objectKey.split("/");
  if (segments.length !== 4) return null;
  const last = segments[3];
  if (last === undefined) return null;
  const assetId = last.split(".")[0] ?? "";
  return UUID.test(assetId) ? assetId : null;
}

function assetPathPrefix(parts: Omit<ObjectKeyParts, "mime">): string {
  const ids = [parts.workspaceId, parts.childId, parts.captureId, parts.assetId];
  for (const id of ids) {
    if (!UUID.test(id)) throw new Error("object key parts must be UUIDs");
  }
  return ids.join("/");
}
