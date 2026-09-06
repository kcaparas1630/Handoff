// Product limits from architecture.md §6. They sit below the provider maxima and are enforced
// server-side; the client shares them so it can refuse an oversized file before uploading.

export const AUDIO_MAX_DURATION_MS = 60_000;
export const AUDIO_MAX_BYTES = 10 * 1024 * 1024;
export const AUDIO_MIME_TYPES = [
  "audio/m4a",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
  "audio/webm",
] as const;

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/heic", "image/webp"] as const;

export const VIDEO_MAX_DURATION_MS = 15_000;
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"] as const;

export const MAX_ATTACHMENTS_PER_CAPTURE = 3;
