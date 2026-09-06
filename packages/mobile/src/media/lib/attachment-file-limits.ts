import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES, VIDEO_MAX_DURATION_MS } from "@handoff/contracts";
import type { AttachmentKind } from "@handoff/contracts";

/**
 * architecture.md section 6: image up to 5 MB, video up to 15 seconds and 20 MB. The server
 * enforces these on the stored bytes; refusing here saves a caregiver a doomed upload.
 */
export function describeAttachmentLimitProblem(file: {
  kind: AttachmentKind;
  sizeBytes: number;
  durationMs?: number | undefined;
}): string | null {
  if (file.sizeBytes <= 0) return "This file is empty, so there is nothing to send.";

  if (file.kind === "image") {
    if (file.sizeBytes > IMAGE_MAX_BYTES) {
      return `This photo is ${megabytes(file.sizeBytes)} MB after resizing, over the ${megabytes(IMAGE_MAX_BYTES)} MB limit.`;
    }
    return null;
  }

  // Videos are sent exactly as recorded, so an over-limit clip has to be re-taken or trimmed.
  if (file.durationMs === undefined) {
    return "This video's length could not be read, so it cannot be checked against the 15 second limit.";
  }
  if (file.durationMs > VIDEO_MAX_DURATION_MS) {
    return `This video is ${seconds(file.durationMs)} seconds long. Handoff sends clips up to ${seconds(VIDEO_MAX_DURATION_MS)} seconds; trim it and try again.`;
  }
  if (file.sizeBytes > VIDEO_MAX_BYTES) {
    return `This video is ${megabytes(file.sizeBytes)} MB, over the ${megabytes(VIDEO_MAX_BYTES)} MB limit. Record a shorter clip and try again.`;
  }
  return null;
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}

function seconds(milliseconds: number): string {
  return String(Math.round(milliseconds / 1000));
}
