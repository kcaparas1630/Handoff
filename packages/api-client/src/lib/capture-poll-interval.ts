import type { CaptureStatus } from "@handoff/contracts";

// architecture.md section 7: poll an active capture every two seconds, with backoff.
export const CAPTURE_POLL_FAST_MS = 2_000;
export const CAPTURE_POLL_SLOW_MS = 5_000;
export const CAPTURE_POLL_BACKOFF_AFTER_MS = 30_000;

const activeStatuses: readonly CaptureStatus[] = ["awaiting_upload", "queued", "processing"];

export function isCaptureInProgress(status: CaptureStatus | null): boolean {
  return status !== null && activeStatuses.includes(status);
}

/**
 * How long to wait before the next status read, or false to stop polling. `elapsedMs` is the time
 * this capture has been watched, so a slow extraction backs off instead of hammering the API.
 */
export function capturePollInterval(
  status: CaptureStatus | null,
  elapsedMs: number,
): number | false {
  if (!isCaptureInProgress(status)) return false;
  return elapsedMs < CAPTURE_POLL_BACKOFF_AFTER_MS ? CAPTURE_POLL_FAST_MS : CAPTURE_POLL_SLOW_MS;
}
