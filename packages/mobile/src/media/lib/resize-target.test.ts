import { describe, expect, it } from "vitest";

import { MAX_IMAGE_EDGE, resizeTargetForImage } from "./resize-target";

describe("resizeTargetForImage", () => {
  it("leaves an image that already fits alone", () => {
    expect(resizeTargetForImage(1600, 1200)).toBeNull();
  });

  it("constrains the width of a landscape photo", () => {
    expect(resizeTargetForImage(4032, 3024)).toEqual({ width: MAX_IMAGE_EDGE });
  });

  it("constrains the height of a portrait photo", () => {
    expect(resizeTargetForImage(3024, 4032)).toEqual({ height: MAX_IMAGE_EDGE });
  });

  it("constrains the width of a square photo so the ratio is preserved either way", () => {
    expect(resizeTargetForImage(3000, 3000)).toEqual({ width: MAX_IMAGE_EDGE });
  });

  it("returns null for dimensions the device did not report", () => {
    expect(resizeTargetForImage(0, 0)).toBeNull();
  });
});
