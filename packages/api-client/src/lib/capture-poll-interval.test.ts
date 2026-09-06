import { describe, expect, it } from "vitest";

import {
  CAPTURE_POLL_BACKOFF_AFTER_MS,
  CAPTURE_POLL_FAST_MS,
  CAPTURE_POLL_SLOW_MS,
  capturePollInterval,
  isCaptureInProgress,
} from "./capture-poll-interval";

describe("capturePollInterval", () => {
  it("polls quickly while the capture is still moving", () => {
    expect(capturePollInterval("awaiting_upload", 0)).toBe(CAPTURE_POLL_FAST_MS);
    expect(capturePollInterval("queued", 1_000)).toBe(CAPTURE_POLL_FAST_MS);
    expect(capturePollInterval("processing", CAPTURE_POLL_BACKOFF_AFTER_MS - 1)).toBe(
      CAPTURE_POLL_FAST_MS,
    );
  });

  it("backs off once the capture has been watched for half a minute", () => {
    expect(capturePollInterval("processing", CAPTURE_POLL_BACKOFF_AFTER_MS)).toBe(
      CAPTURE_POLL_SLOW_MS,
    );
    expect(capturePollInterval("queued", 120_000)).toBe(CAPTURE_POLL_SLOW_MS);
  });

  it("stops polling once the capture reaches a state the reviewer acts on", () => {
    expect(capturePollInterval("needs_review", 0)).toBe(false);
    expect(capturePollInterval("confirmed", 0)).toBe(false);
    expect(capturePollInterval("failed", 0)).toBe(false);
    expect(capturePollInterval("cancelled", 0)).toBe(false);
    expect(capturePollInterval(null, 0)).toBe(false);
  });

  it("reports progress only for the statuses the server is still working on", () => {
    expect(isCaptureInProgress("processing")).toBe(true);
    expect(isCaptureInProgress("needs_review")).toBe(false);
    expect(isCaptureInProgress(null)).toBe(false);
  });
});
