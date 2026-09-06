import { describe, expect, it } from "vitest";

import { describeAttachmentLimitProblem } from "./attachment-file-limits";

describe("describeAttachmentLimitProblem", () => {
  it("accepts a photo inside the size limit", () => {
    expect(describeAttachmentLimitProblem({ kind: "image", sizeBytes: 900_000 })).toBeNull();
  });

  it("names the limit when a photo is still too large after resizing", () => {
    const problem = describeAttachmentLimitProblem({ kind: "image", sizeBytes: 6 * 1024 * 1024 });
    expect(problem).toContain("5 MB limit");
  });

  it("accepts a clip inside both video limits", () => {
    const problem = describeAttachmentLimitProblem({
      kind: "video",
      sizeBytes: 4 * 1024 * 1024,
      durationMs: 12_000,
    });
    expect(problem).toBeNull();
  });

  it("refuses a clip longer than fifteen seconds before any upload", () => {
    const problem = describeAttachmentLimitProblem({
      kind: "video",
      sizeBytes: 1_000,
      durationMs: 21_000,
    });
    expect(problem).toContain("21 seconds long");
  });

  it("refuses an over-limit clip by size even when it is short", () => {
    const problem = describeAttachmentLimitProblem({
      kind: "video",
      sizeBytes: 25 * 1024 * 1024,
      durationMs: 9_000,
    });
    expect(problem).toContain("20 MB limit");
  });

  it("refuses a clip whose length the device did not report", () => {
    const problem = describeAttachmentLimitProblem({ kind: "video", sizeBytes: 1_000 });
    expect(problem).toContain("15 second limit");
  });

  it("refuses an empty file", () => {
    expect(describeAttachmentLimitProblem({ kind: "image", sizeBytes: 0 })).toContain("empty");
  });
});
