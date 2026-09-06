import type { AudioMimeType } from "../types/recorder";

// Only the containers the API accepts. An unknown extension returns null so the recording is
// reported as unusable instead of being uploaded under a guessed content type.
const mimeByExtension: Readonly<Record<string, AudioMimeType>> = {
  ".m4a": "audio/m4a",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

export function recordingMimeForUri(uri: string): AudioMimeType | null {
  const withoutQuery = uri.split("?")[0] ?? uri;
  const lastDot = withoutQuery.lastIndexOf(".");
  if (lastDot < 0) return null;
  return mimeByExtension[withoutQuery.slice(lastDot).toLowerCase()] ?? null;
}

/** The file suffix to store the recording under, including the leading dot. */
export function recordingExtensionForUri(uri: string): string | null {
  const withoutQuery = uri.split("?")[0] ?? uri;
  const lastDot = withoutQuery.lastIndexOf(".");
  if (lastDot < 0) return null;
  const extension = withoutQuery.slice(lastDot).toLowerCase();
  return mimeByExtension[extension] === undefined ? null : extension;
}

export function isSupportedAudioMime(value: string): value is AudioMimeType {
  // The map values are typed against the contract list, so this stays in step with it.
  return Object.values(mimeByExtension).includes(value as AudioMimeType);
}
