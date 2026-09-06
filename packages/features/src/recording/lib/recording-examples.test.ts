import { describe, expect, it } from "vitest";

import { exampleAt, formatElapsed, recordingExamples } from "./recording-examples";

describe("exampleAt", () => {
  it("rotates through the examples and wraps around", () => {
    expect(exampleAt(0)).toBe(recordingExamples[0]);
    expect(exampleAt(recordingExamples.length)).toBe(recordingExamples[0]);
    expect(exampleAt(-1)).toBe(recordingExamples[recordingExamples.length - 1]);
  });
});

describe("formatElapsed", () => {
  it("reads as minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_400)).toBe("0:09");
    expect(formatElapsed(60_000)).toBe("1:00");
  });

  it("never shows a negative reading", () => {
    expect(formatElapsed(-500)).toBe("0:00");
  });
});
