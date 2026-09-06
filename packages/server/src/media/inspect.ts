// Byte inspection for an uploaded attachment. The client's declared MIME type is a claim; this is
// where the server finds out what was actually stored (architecture §6). Nothing here reads the
// database, and no rejection reason repeats provider text or file content.
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { attachmentLimitsFor } from "./lib/attachment-limits";
import { inspectMp4Container } from "./lib/mp4-duration";
import type { AttachmentKind } from "@handoff/contracts";

export type MediaRejection = "mime_mismatch" | "unsupported" | "corrupt" | "too_large" | "too_long";

export interface InspectedMedia {
  /** What the bytes are, which is what the asset is published as. */
  verifiedMime: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export type MediaInspection = InspectedMedia | { rejected: MediaRejection };

export function isRejected(
  inspection: MediaInspection,
): inspection is { rejected: MediaRejection } {
  return "rejected" in inspection;
}

/**
 * One byte signature can legitimately be labelled two ways: an iPhone `.mov` and an `.mp4` share
 * the ISO base media container, and HEIC and HEIF share theirs. Everything outside these pairs
 * must match the declared type exactly, so a PNG uploaded as `image/jpeg` is still a spoof.
 */
const equivalentMimeTypes: readonly (readonly string[])[] = [
  ["video/mp4", "video/quicktime"],
  ["image/heic", "image/heif"],
];

function matchesDeclaredMime(detected: string, declared: string): boolean {
  if (detected === declared) return true;
  return equivalentMimeTypes.some((pair) => pair.includes(detected) && pair.includes(declared));
}

export async function inspectMedia({
  bytes,
  declaredMime,
  kind,
}: {
  bytes: Buffer;
  declaredMime: string;
  kind: AttachmentKind;
}): Promise<MediaInspection> {
  const limits = attachmentLimitsFor(kind);
  if (bytes.byteLength > limits.maxBytes) return { rejected: "too_large" };

  const detected = await fileTypeFromBuffer(bytes);
  // No signature at all is not a photo or a video, whatever the request said it was.
  if (detected === undefined) return { rejected: "unsupported" };
  // Bytes of the wrong kind entirely, or a format the product does not accept, never reach a
  // decoder. A PNG uploaded as `image/jpeg` is in the allowlist but is still a spoof.
  if (!limits.mimeTypes.includes(detected.mime)) return { rejected: "unsupported" };
  if (!matchesDeclaredMime(detected.mime, declaredMime)) return { rejected: "mime_mismatch" };

  return kind === "image" ? inspectImage(bytes, detected.mime) : inspectVideo(bytes, detected.mime);
}

async function inspectImage(bytes: Buffer, verifiedMime: string): Promise<MediaInspection> {
  try {
    const metadata = await sharp(bytes).metadata();
    // The orientation tag can swap the axes, so the published dimensions are the oriented ones.
    const width = metadata.autoOrient.width;
    const height = metadata.autoOrient.height;
    if (width <= 0 || height <= 0) return { rejected: "corrupt" };
    return { verifiedMime, width, height };
  } catch {
    // sharp throws on anything it cannot decode. The decoder's message is not ours to repeat.
    return { rejected: "corrupt" };
  }
}

function inspectVideo(bytes: Buffer, verifiedMime: string): MediaInspection {
  const container = inspectMp4Container(bytes);
  if (!container.ok) {
    if (container.reason === "unsupported_brand") return { rejected: "unsupported" };
    return { rejected: "corrupt" };
  }
  const maxDurationMs = attachmentLimitsFor("video").maxDurationMs;
  if (maxDurationMs !== null && container.durationMs > maxDurationMs) {
    return { rejected: "too_long" };
  }
  return { verifiedMime, durationMs: container.durationMs };
}
