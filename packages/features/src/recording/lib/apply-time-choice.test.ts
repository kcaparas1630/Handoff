import { formatWallClock, formatWallDate } from "@handoff/domain";
import { describe, expect, it } from "vitest";

import {
  applyDayChoice,
  applyMeridiemChoice,
  currentDayChoice,
  currentMeridiem,
  describeTimePrompt,
} from "./apply-time-choice";

const timezone = "Europe/Helsinki";
// 02:00 local on 6 September, recorded at 09:05 the same local morning.
const occurredAt = new Date("2026-09-05T23:00:00.000Z");
const capturedAt = new Date("2026-09-06T06:05:00.000Z");

describe("applyDayChoice", () => {
  it("keeps the clock reading and only moves the calendar day", () => {
    const yesterday = applyDayChoice({
      occurredAt,
      capturedAt,
      timezone,
      choice: "previous-day",
    });
    expect(formatWallClock(yesterday, timezone)).toBe("02:00");
    expect(formatWallDate(yesterday, timezone)).toBe("2026-09-05");
  });

  it("returns the capture's own day when that is the choice", () => {
    const today = applyDayChoice({ occurredAt, capturedAt, timezone, choice: "capture-day" });
    expect(formatWallDate(today, timezone)).toBe("2026-09-06");
    expect(formatWallClock(today, timezone)).toBe("02:00");
  });

  it("reports which day is currently selected", () => {
    expect(currentDayChoice(occurredAt, capturedAt, timezone)).toBe("capture-day");
    const yesterday = applyDayChoice({
      occurredAt,
      capturedAt,
      timezone,
      choice: "previous-day",
    });
    expect(currentDayChoice(yesterday, capturedAt, timezone)).toBe("previous-day");
  });
});

describe("applyMeridiemChoice", () => {
  it("moves 02:00 to 14:00 and back without changing the date", () => {
    const afternoon = applyMeridiemChoice({ occurredAt, timezone, choice: "pm" });
    expect(formatWallClock(afternoon, timezone)).toBe("14:00");
    expect(formatWallDate(afternoon, timezone)).toBe("2026-09-06");

    const morning = applyMeridiemChoice({ occurredAt: afternoon, timezone, choice: "am" });
    expect(formatWallClock(morning, timezone)).toBe("02:00");
  });

  it("handles noon and midnight without rolling over", () => {
    const noon = new Date("2026-09-06T09:00:00.000Z");
    expect(formatWallClock(noon, timezone)).toBe("12:00");
    const midnight = applyMeridiemChoice({ occurredAt: noon, timezone, choice: "am" });
    expect(formatWallClock(midnight, timezone)).toBe("00:00");
    expect(formatWallDate(midnight, timezone)).toBe("2026-09-06");
  });

  it("reports which half of the day is currently selected", () => {
    expect(currentMeridiem(occurredAt, timezone)).toBe("am");
    expect(currentMeridiem(new Date("2026-09-06T15:00:00.000Z"), timezone)).toBe("pm");
  });
});

describe("describeTimePrompt", () => {
  it("asks the specific question for each open flag", () => {
    expect(describeTimePrompt(occurredAt, timezone, ["date_unknown"])).toBe("Which day was 02:00?");
    expect(describeTimePrompt(occurredAt, timezone, ["am_pm_unknown"])).toBe(
      "Morning or afternoon?",
    );
    expect(describeTimePrompt(occurredAt, timezone, ["date_unknown", "am_pm_unknown"])).toBe(
      "Which day was 02:00? Morning or afternoon?",
    );
  });

  it("stays silent when the time is settled or was never stated", () => {
    expect(describeTimePrompt(occurredAt, timezone, ["amount_unknown"])).toBeNull();
    expect(describeTimePrompt(null, timezone, ["date_unknown"])).toBeNull();
  });
});
