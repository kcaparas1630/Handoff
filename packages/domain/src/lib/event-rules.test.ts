import { describe, expect, it } from "vitest";
import type { EventDetails } from "@handoff/contracts";
import {
  isCompletedCareCandidate,
  isCompletedCareFact,
  validateEventSemantics,
} from "./event-rules";
import type { EventSemanticsInput } from "../types/events";

const OCCURRED = new Date("2026-09-06T09:00:00.000Z");

function input(overrides: Partial<EventSemanticsInput> = {}): EventSemanticsInput {
  return {
    kind: "feed",
    occurredAt: OCCURRED,
    endedAt: null,
    timePrecision: "exact",
    amountValue: "60.00",
    amountUnit: "ml",
    details: { kind: "feed", method: "bottle" },
    ...overrides,
  };
}

function fields(result: ReturnType<typeof validateEventSemantics>): string[] {
  return result.ok ? [] : result.errors.map((error) => error.field);
}

describe("validateEventSemantics", () => {
  it("accepts a feed with a stated amount and unit", () => {
    expect(validateEventSemantics(input())).toEqual({ ok: true });
  });

  it("accepts a feed with no amount at all", () => {
    expect(validateEventSemantics(input({ amountValue: null, amountUnit: null }))).toEqual({
      ok: true,
    });
  });

  it("rejects an amount without its unit and a unit without its amount", () => {
    expect(fields(validateEventSemantics(input({ amountUnit: null })))).toContain("amountUnit");
    expect(fields(validateEventSemantics(input({ amountValue: null })))).toContain("amountValue");
  });

  it.each(["0", "0.00", "-5.00", "60.005", "999999999.00"])("rejects the amount %s", (value) => {
    expect(fields(validateEventSemantics(input({ amountValue: value })))).toContain("amountValue");
  });

  it("rejects a unit a feed does not use", () => {
    expect(fields(validateEventSemantics(input({ amountUnit: "minutes" })))).toContain(
      "amountUnit",
    );
  });

  // Sleep duration comes from the interval, so an amount there could contradict the times.
  it("rejects an amount on kinds that record no quantity", () => {
    const sleep = validateEventSemantics(
      input({
        kind: "sleep",
        details: { kind: "sleep", state: "interval" },
        endedAt: new Date("2026-09-06T09:40:00.000Z"),
        amountValue: "40.00",
        amountUnit: "minutes",
      }),
    );
    expect(fields(sleep)).toContain("amountValue");
  });

  it("requires details that match the event kind", () => {
    const mismatched = validateEventSemantics(
      input({ kind: "note", details: { kind: "feed", method: "bottle" } }),
    );
    expect(fields(mismatched)).toContain("details.kind");
  });

  it("keeps unknown occurrence and unknown precision in step", () => {
    expect(fields(validateEventSemantics(input({ occurredAt: null })))).toContain("timePrecision");
    expect(fields(validateEventSemantics(input({ timePrecision: "unknown" })))).toContain(
      "occurredAt",
    );
  });

  it("accepts an unknown-time feed reported without a clock reading", () => {
    const result = validateEventSemantics(
      input({ occurredAt: null, timePrecision: "unknown", amountValue: null, amountUnit: null }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("requires an end time to have a start that does not follow it", () => {
    const orphan = validateEventSemantics(
      input({ occurredAt: null, timePrecision: "unknown", endedAt: OCCURRED }),
    );
    expect(fields(orphan)).toContain("endedAt");

    const backwards = validateEventSemantics(
      input({
        kind: "sleep",
        details: { kind: "sleep", state: "interval" },
        amountValue: null,
        amountUnit: null,
        occurredAt: OCCURRED,
        endedAt: new Date("2026-09-06T08:00:00.000Z"),
      }),
    );
    expect(fields(backwards)).toContain("endedAt");
  });

  it("requires both ends of a sleep interval and a single time for a reported start", () => {
    const openInterval = validateEventSemantics(
      input({
        kind: "sleep",
        details: { kind: "sleep", state: "interval" },
        amountValue: null,
        amountUnit: null,
      }),
    );
    expect(fields(openInterval)).toContain("endedAt");

    const pairedStart = validateEventSemantics(
      input({
        kind: "sleep",
        details: { kind: "sleep", state: "started" },
        amountValue: null,
        amountUnit: null,
        endedAt: new Date("2026-09-06T09:40:00.000Z"),
      }),
    );
    expect(fields(pairedStart)).toContain("endedAt");
  });
});

describe("isCompletedCareFact", () => {
  const planned: EventDetails = { kind: "note", text: "Give 60 ml later", intent: "planned" };
  const question: EventDetails = { kind: "note", text: "Is she teething?", intent: "question" };
  const observed: EventDetails = { kind: "note", text: "Very cheerful", intent: "observation" };

  it("excludes plans and questions", () => {
    expect(isCompletedCareFact("note", planned)).toBe(false);
    expect(isCompletedCareFact("note", question)).toBe(false);
    expect(isCompletedCareFact("note", observed)).toBe(true);
  });

  it("includes recorded care and reported moments", () => {
    expect(isCompletedCareFact("feed", { kind: "feed", method: "bottle" })).toBe(true);
    expect(isCompletedCareFact("diaper", { kind: "diaper", contents: "wet" })).toBe(true);
  });

  it("excludes a negated, planned, or discarded candidate", () => {
    const feed: EventDetails = { kind: "feed", method: "bottle" };
    expect(
      isCompletedCareCandidate({
        kind: "feed",
        details: feed,
        ambiguities: ["negation"],
        discarded: false,
      }),
    ).toBe(false);
    expect(
      isCompletedCareCandidate({
        kind: "feed",
        details: feed,
        ambiguities: ["planned"],
        discarded: false,
      }),
    ).toBe(false);
    expect(
      isCompletedCareCandidate({ kind: "feed", details: feed, ambiguities: [], discarded: true }),
    ).toBe(false);
    expect(
      isCompletedCareCandidate({ kind: "feed", details: feed, ambiguities: [], discarded: false }),
    ).toBe(true);
  });
});
