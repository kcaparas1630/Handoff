import { describe, expect, it } from "vitest";
import { resolveEventTime } from "./resolve-event-time";
import type { SpokenTime } from "../types/event-time";

const VANCOUVER = "America/Vancouver";

function resolve(spokenTime: SpokenTime | null, capturedAt: string) {
  return resolveEventTime({ spokenTime, capturedAt: new Date(capturedAt), timezone: VANCOUVER });
}

describe("resolveEventTime", () => {
  it("leaves an unspoken time unknown instead of using the capture time", () => {
    const result = resolve(null, "2026-09-06T16:00:00.000Z");
    expect(result).toEqual({
      occurredAt: null,
      timePrecision: "unknown",
      ambiguities: [],
      proposedDates: [],
    });
  });

  it("treats an explicit now as the capture time with approximate precision", () => {
    const capturedAt = "2026-09-06T16:00:00.000Z";
    const result = resolve({ isNow: true }, capturedAt);
    expect(result.occurredAt?.toISOString()).toBe(capturedAt);
    expect(result.timePrecision).toBe("approximate");
    expect(result.ambiguities).toEqual([]);
  });

  it("resolves midnight to the start of the capture day", () => {
    const result = resolve({ hour: 12, minute: 0, meridiem: "am" }, "2026-09-06T20:00:00.000Z");
    expect(result.occurredAt?.toISOString()).toBe("2026-09-06T07:00:00.000Z");
    expect(result.timePrecision).toBe("exact");
    expect(result.ambiguities).toEqual([]);
  });

  // 2026-03-08 is the US spring-forward day: 02:00 local never happens in Vancouver.
  it("flags a nonexistent spring-forward time and resolves past the shift", () => {
    const result = resolve({ hour: 2, minute: 0, meridiem: "am" }, "2026-03-08T20:00:00.000Z");
    expect(result.ambiguities).toContain("dst_ambiguous");
    expect(result.proposedDates).toHaveLength(1);
    expect(result.occurredAt?.toISOString()).toBe("2026-03-08T10:00:00.000Z");
  });

  // 2026-11-01 is the US fall-back day: 01:30 local happens twice in Vancouver.
  it("offers both readings of an ambiguous fall-back time", () => {
    const result = resolve({ hour: 1, minute: 30, meridiem: "am" }, "2026-11-01T20:00:00.000Z");
    expect(result.ambiguities).toContain("dst_ambiguous");
    expect(result.proposedDates.map((date) => date.toISOString())).toEqual([
      "2026-11-01T09:30:00.000Z",
      "2026-11-01T08:30:00.000Z",
    ]);
  });

  it('offers both meridiems for "at two" and never picks one silently', () => {
    const result = resolve({ hour: 2 }, "2026-09-06T16:00:00.000Z");
    expect(result.ambiguities).toEqual(["date_unknown", "am_pm_unknown"]);
    expect(result.proposedDates.map((date) => date.toISOString())).toEqual([
      "2026-09-06T09:00:00.000Z",
      "2026-09-05T21:00:00.000Z",
    ]);
    expect(result.occurredAt?.toISOString()).toBe("2026-09-06T09:00:00.000Z");
  });

  it("moves a time later than the capture to the previous day and flags the date", () => {
    const result = resolve({ hour: 14, minute: 30 }, "2026-09-06T16:00:00.000Z");
    expect(result.ambiguities).toEqual(["date_unknown"]);
    expect(result.occurredAt?.toISOString()).toBe("2026-09-05T21:30:00.000Z");
  });

  it("keeps a stated yesterday without inventing a date flag", () => {
    const result = resolve({ hour: 8, meridiem: "am", dayOffset: -1 }, "2026-09-06T16:00:00.000Z");
    expect(result.ambiguities).toEqual([]);
    expect(result.occurredAt?.toISOString()).toBe("2026-09-05T15:00:00.000Z");
  });

  it("does not flag am/pm for a stated 24-hour reading", () => {
    const result = resolve({ hour: 13, minute: 5 }, "2026-09-06T22:00:00.000Z");
    expect(result.ambiguities).toEqual([]);
    expect(result.occurredAt?.toISOString()).toBe("2026-09-06T20:05:00.000Z");
  });

  it("rejects an impossible clock reading rather than clamping it", () => {
    expect(resolve({ hour: 25 }, "2026-09-06T16:00:00.000Z").occurredAt).toBeNull();
    expect(resolve({ hour: 9, minute: 90 }, "2026-09-06T16:00:00.000Z").occurredAt).toBeNull();
  });
});
