import { MAX_ATTACHMENTS_PER_CAPTURE } from "@handoff/contracts";
import { describe, expect, it } from "vitest";

import { describeAttachmentLimit, remainingAttachmentSlots } from "./attachment-limits";

describe("remainingAttachmentSlots", () => {
  it("offers every slot on a capture with nothing attached", () => {
    expect(remainingAttachmentSlots(0, 0)).toBe(MAX_ATTACHMENTS_PER_CAPTURE);
  });

  it("counts queued files and published ones against the same limit", () => {
    expect(remainingAttachmentSlots(1, 1)).toBe(MAX_ATTACHMENTS_PER_CAPTURE - 2);
  });

  it("never reports a negative number of slots", () => {
    expect(remainingAttachmentSlots(3, 4)).toBe(0);
  });

  it("ignores a nonsense negative count rather than inventing extra room", () => {
    expect(remainingAttachmentSlots(-2, 3)).toBe(0);
  });
});

describe("describeAttachmentLimit", () => {
  it("says how much room is left in the singular", () => {
    expect(describeAttachmentLimit(1)).toBe("You can add 1 more file to this update.");
  });

  it("states the limit when the capture is full", () => {
    expect(describeAttachmentLimit(0)).toContain(`maximum of ${MAX_ATTACHMENTS_PER_CAPTURE} files`);
  });
});
