import { describe, expect, it } from "vitest";

import { normaliseMeteringLevel } from "./metering-level";

describe("normaliseMeteringLevel", () => {
  it("returns null when the platform reports no metering", () => {
    expect(normaliseMeteringLevel(undefined)).toBeNull();
    expect(normaliseMeteringLevel(Number.NaN)).toBeNull();
  });

  it("maps the usable dBFS range onto 0-1", () => {
    expect(normaliseMeteringLevel(0)).toBe(1);
    expect(normaliseMeteringLevel(-30)).toBeCloseTo(0.5, 5);
    expect(normaliseMeteringLevel(-60)).toBe(0);
  });

  it("clamps readings outside the range instead of overflowing the indicator", () => {
    expect(normaliseMeteringLevel(-160)).toBe(0);
    expect(normaliseMeteringLevel(12)).toBe(1);
  });
});
