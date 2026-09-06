import { describe, expect, it } from "vitest";
import { amountValueSchema, eventDetailsSchema } from "./events";

describe("amountValue", () => {
  it.each(["60", "60.5", "60.00", "0.01", "99999999.99"])("accepts %s", (value) => {
    expect(amountValueSchema.safeParse(value).success).toBe(true);
  });

  // Zero is not a measurement, and a float would not round-trip numeric(10,2) exactly.
  it.each(["0", "0.00", "-60.00", "60.005", "100000000.00", "60,00", "", "6e1"])(
    "rejects %s",
    (value) => {
      expect(amountValueSchema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects a number so a caller cannot send a float", () => {
    expect(amountValueSchema.safeParse(60).success).toBe(false);
  });
});

describe("eventDetails", () => {
  it("accepts each kind's documented shape", () => {
    const details = [
      { kind: "feed", method: "bottle", description: "took it all" },
      { kind: "diaper", contents: "both", quantity: "a lot" },
      { kind: "sleep", state: "interval" },
      { kind: "milestone", description: "first word", quote: "Dada", reportedFirst: true },
      { kind: "note", text: "Give 60 ml later", intent: "planned" },
    ];
    for (const value of details) {
      expect(eventDetailsSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects fields from another kind and unknown members", () => {
    expect(eventDetailsSchema.safeParse({ kind: "feed", contents: "wet" }).success).toBe(false);
    expect(eventDetailsSchema.safeParse({ kind: "walk", steps: 2 }).success).toBe(false);
  });

  it("requires a milestone to state whether a first was reported", () => {
    const parsed = eventDetailsSchema.safeParse({ kind: "milestone", description: "rolled over" });
    expect(parsed.success).toBe(false);
  });
});
