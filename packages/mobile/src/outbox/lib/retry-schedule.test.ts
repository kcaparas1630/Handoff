import { describe, expect, it } from "vitest";

import {
  MAX_AUTOMATIC_ATTEMPTS,
  isAttemptDue,
  isTerminalUploadError,
  planRetry,
  retryDelayMs,
} from "./retry-schedule";

const now = new Date("2026-09-06T09:00:00.000Z");

describe("retryDelayMs", () => {
  it("doubles from two seconds and stops at five minutes", () => {
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(2)).toBe(4_000);
    expect(retryDelayMs(3)).toBe(8_000);
    expect(retryDelayMs(20)).toBe(300_000);
  });
});

describe("planRetry", () => {
  it("schedules another attempt for a transient failure", () => {
    const plan = planRetry({ errorCode: "network_unavailable", previousAttempts: 1, now });
    expect(plan.isTerminal).toBe(false);
    expect(plan.attempts).toBe(2);
    expect(plan.nextAttemptAt).toBe("2026-09-06T09:00:04.000Z");
  });

  it("stops after the automatic attempt budget and waits for the caregiver", () => {
    const plan = planRetry({
      errorCode: "internal",
      previousAttempts: MAX_AUTOMATIC_ATTEMPTS - 1,
      now,
    });
    expect(plan.isTerminal).toBe(true);
    expect(plan.nextAttemptAt).toBeNull();
  });

  it("never retries a permission or validation failure", () => {
    const plan = planRetry({ errorCode: "forbidden", previousAttempts: 0, now });
    expect(plan.isTerminal).toBe(true);
    expect(plan.attempts).toBe(1);
  });
});

describe("isTerminalUploadError", () => {
  it("separates terminal server answers from transient ones", () => {
    expect(isTerminalUploadError("not_found")).toBe(true);
    expect(isTerminalUploadError("rate_limited")).toBe(false);
    expect(isTerminalUploadError("upload_status_500")).toBe(false);
  });
});

describe("isAttemptDue", () => {
  it("treats a row that has never failed as due", () => {
    expect(isAttemptDue(null, now)).toBe(true);
  });

  it("waits for the scheduled instant", () => {
    expect(isAttemptDue("2026-09-06T09:00:05.000Z", now)).toBe(false);
    expect(isAttemptDue("2026-09-06T08:59:59.000Z", now)).toBe(true);
  });

  it("does not strand a row whose stored instant cannot be read", () => {
    expect(isAttemptDue("not-a-date", now)).toBe(true);
  });
});
