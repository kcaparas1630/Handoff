import { describe, expect, it } from "vitest";

import { describeAttachmentProgress, summariseAttachments } from "./attachment-summary";

describe("summariseAttachments", () => {
  it("counts an empty queue as nothing outstanding", () => {
    expect(summariseAttachments([])).toEqual({
      localCount: 0,
      savedLocallyCount: 0,
      awaitingValidationCount: 0,
      failedCount: 0,
    });
  });

  it("treats an allocated but unsent file as still on this phone", () => {
    const summary = summariseAttachments([{ stage: "saved_locally" }, { stage: "asset_created" }]);
    expect(summary).toMatchObject({ localCount: 2, savedLocallyCount: 2 });
  });

  it("counts uploaded and completed rows as awaiting validation", () => {
    const summary = summariseAttachments([{ stage: "uploaded" }, { stage: "completed" }]);
    expect(summary).toMatchObject({ awaitingValidationCount: 2, savedLocallyCount: 0 });
  });

  it("keeps failed rows separate so a retry can be offered", () => {
    const summary = summariseAttachments([{ stage: "failed" }, { stage: "uploaded" }]);
    expect(summary).toMatchObject({ localCount: 2, failedCount: 1, awaitingValidationCount: 1 });
  });
});

describe("describeAttachmentProgress", () => {
  it("says nothing when the queue is empty", () => {
    expect(describeAttachmentProgress(summariseAttachments([]))).toBeNull();
  });

  it("distinguishes a file on this phone from one waiting for checks", () => {
    const sentence = describeAttachmentProgress(
      summariseAttachments([{ stage: "saved_locally" }, { stage: "uploaded" }]),
    );
    expect(sentence).toBe("1 file on this phone, not yet shared, 1 file waiting for checks.");
  });

  it("names files that could not be sent", () => {
    const sentence = describeAttachmentProgress(
      summariseAttachments([{ stage: "failed" }, { stage: "failed" }]),
    );
    expect(sentence).toBe("2 files that could not be sent.");
  });
});
