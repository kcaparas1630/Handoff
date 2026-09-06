import type { CareSessionDto } from "@handoff/contracts";
import { describe, expect, it } from "vitest";

import { describeCaring } from "./caring-line";

function session(overrides: Partial<CareSessionDto>): CareSessionDto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    childId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "33333333-3333-4333-8333-333333333333",
    userId: "44444444-4444-4444-8444-444444444444",
    displayName: "Alex",
    startedAt: "2026-09-06T08:00:00.000Z",
    endedAt: null,
    endReason: null,
    version: 1,
    ...overrides,
  };
}

describe("describeCaring", () => {
  it("states plainly when nobody declared care", () => {
    expect(describeCaring([], "me")).toBe("Nobody is caring right now");
  });

  it("names one other caregiver", () => {
    expect(describeCaring([session({})], "me")).toBe("Alex is caring");
  });

  it("falls back when the name is not shared", () => {
    expect(describeCaring([session({ displayName: null })], "me")).toBe("A caregiver is caring");
  });

  it("uses the caller's own wording", () => {
    expect(describeCaring([session({ userId: "me" })], "me")).toBe("You are caring");
  });

  it("keeps every concurrent caregiver", () => {
    const sessions = [session({}), session({ id: "b", userId: "me" })];
    expect(describeCaring(sessions, "me")).toBe("Alex and You are caring");
  });

  it("ignores sessions that already ended", () => {
    const ended = session({ endedAt: "2026-09-06T09:00:00.000Z", endReason: "user_ended" });
    expect(describeCaring([ended], "me")).toBe("Nobody is caring right now");
  });
});
