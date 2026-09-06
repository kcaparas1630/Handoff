import { describe, expect, it } from "vitest";

import { describeCaptureStatus } from "./describe-capture-status";

const base = { outboxStage: null, captureStatus: null, hasTranscript: false } as const;

describe("describeCaptureStatus", () => {
  it("says saved on this phone, and does not imply it was shared", () => {
    const progress = describeCaptureStatus({ ...base, outboxStage: "saved_locally" });
    expect(progress.headline).toBe("Saved on this phone");
    expect(progress.detail).toContain("Not shared yet");
    expect(progress.steps[0]?.state).toBe("current");
    expect(progress.isSettled).toBe(false);
  });

  it("keeps an allocated capture at the same wording until the bytes are sent", () => {
    expect(describeCaptureStatus({ ...base, outboxStage: "capture_created" }).headline).toBe(
      "Saved on this phone",
    );
    expect(describeCaptureStatus({ ...base, outboxStage: "uploaded" }).headline).toBe("Uploading");
  });

  it("takes the further of the local stage and a stale server answer", () => {
    const progress = describeCaptureStatus({
      outboxStage: "completed",
      captureStatus: "awaiting_upload",
      hasTranscript: false,
    });
    expect(progress.headline).toBe("Preparing your update");
  });

  it("only claims a transcript exists when one is present", () => {
    expect(
      describeCaptureStatus({ ...base, captureStatus: "processing", hasTranscript: false })
        .headline,
    ).toBe("Preparing your update");
    expect(
      describeCaptureStatus({ ...base, captureStatus: "processing", hasTranscript: true }).headline,
    ).toBe("Transcribed, preparing draft");
    expect(
      describeCaptureStatus({ ...base, captureStatus: "queued", hasTranscript: true }).headline,
    ).toBe("Preparing your update");
  });

  it("reports a reviewable draft without implying it was saved", () => {
    const progress = describeCaptureStatus({ ...base, captureStatus: "needs_review" });
    expect(progress.headline).toBe("Ready for review");
    expect(progress.detail).toContain("Nothing is saved until you tap Save");
    expect(progress.isSettled).toBe(true);
    expect(progress.steps.every((step) => step.state !== "pending")).toBe(true);
  });

  it("separates a local send failure from a processing failure", () => {
    const local = describeCaptureStatus({ ...base, outboxStage: "failed" });
    expect(local.hasFailed).toBe(true);
    expect(local.headline).toContain("still on this phone");

    const server = describeCaptureStatus({ ...base, captureStatus: "failed" });
    expect(server.hasFailed).toBe(true);
    expect(server.headline).toContain("could not be turned into an update");
  });

  it("reports a confirmed capture as published", () => {
    const progress = describeCaptureStatus({ ...base, captureStatus: "confirmed" });
    expect(progress.headline).toBe("Saved to the journal");
    expect(progress.tone).toBe("success");
  });
});
