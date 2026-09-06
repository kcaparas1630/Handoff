import { describe, expect, it } from "vitest";

import { attachmentTileStatus, describeStageFailure } from "./attachment-state";

const base = { kind: "image", lastErrorCode: null } as const;

describe("attachmentTileStatus", () => {
  it("calls a saved but unsent file local", () => {
    expect(attachmentTileStatus({ ...base, stage: "saved_locally" })).toEqual({
      state: "local",
      kind: "image",
    });
  });

  it("still calls an allocated file local, because the bytes have not been accepted", () => {
    expect(attachmentTileStatus({ ...base, stage: "asset_created" })).toMatchObject({
      state: "local",
    });
  });

  it("calls an uploaded file pending rather than ready", () => {
    expect(attachmentTileStatus({ ...base, stage: "uploaded" })).toMatchObject({
      state: "pending",
    });
  });

  it("never reports a queued row as ready", () => {
    const stages = ["saved_locally", "asset_created", "uploaded", "completed", "failed"] as const;
    for (const stage of stages) {
      expect(attachmentTileStatus({ ...base, stage }).state).not.toBe("ready");
    }
  });

  it("carries a readable reason on a failed row", () => {
    const status = attachmentTileStatus({
      kind: "video",
      stage: "failed",
      lastErrorCode: "attachment_authorization_expired",
    });
    expect(status).toEqual({
      state: "failed",
      kind: "video",
      message: "the upload window closed before it finished",
    });
  });
});

describe("describeStageFailure", () => {
  it("falls back to a plain sentence for an unrecognised code", () => {
    expect(describeStageFailure("upload_status_503")).toBe("it could not be sent");
  });

  it("explains a revoked grant without naming the server", () => {
    expect(describeStageFailure("forbidden")).toBe("you no longer have access to this child");
  });
});
