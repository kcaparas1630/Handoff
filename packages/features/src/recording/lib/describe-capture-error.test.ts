import { describe, expect, it } from "vitest";

import { canRetryCaptureError, describeCaptureError } from "./describe-capture-error";

describe("describeCaptureError", () => {
  it("explains each known failure in plain words", () => {
    expect(describeCaptureError("transcription_failed")).toContain("could not be turned into text");
    expect(describeCaptureError("invalid_audio")).toContain("could not be read as audio");
  });

  it("falls back without inventing a cause", () => {
    expect(describeCaptureError(null)).toBe("Something went wrong while preparing this update.");
    expect(describeCaptureError("some_future_code")).toBe(
      "Something went wrong while preparing this update.",
    );
  });
});

describe("canRetryCaptureError", () => {
  it("offers a retry where running again could help", () => {
    expect(canRetryCaptureError("transcription_failed")).toBe(true);
    expect(canRetryCaptureError("provider_quota")).toBe(true);
  });

  it("does not offer a retry when the recording itself is the problem", () => {
    expect(canRetryCaptureError("invalid_audio")).toBe(false);
    expect(canRetryCaptureError("upload_missing")).toBe(false);
  });
});
