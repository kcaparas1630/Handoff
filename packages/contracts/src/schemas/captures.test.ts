import { describe, expect, it } from "vitest";
import { createCaptureRequestSchema, draftCandidateSchema } from "./captures";

const CANDIDATE = {
  id: "6f1d2d0e-5d3f-4a8f-9c9b-0f8f8b6d1a11",
  kind: "feed",
  occurredAt: "2026-09-06T09:00:00.000Z",
  endedAt: null,
  timePrecision: "exact",
  amountValue: "60.00",
  amountUnit: "ml",
  details: { kind: "feed", method: "bottle" },
  important: false,
  sourceQuote: null,
  sourceStart: null,
  sourceEnd: null,
  ambiguities: [],
  discarded: false,
};

const BASE_REQUEST = {
  childId: "2b7c0c1e-9a6d-4d55-8f4a-2a2b3c4d5e6f",
  clientCaptureId: "0c1d2e3f-4a5b-4c7d-8e9f-0a1b2c3d4e5f",
  capturedAt: "2026-09-06T16:00:00.000Z",
  timezone: "America/Vancouver",
  locale: "en-CA",
};

describe("draftCandidate", () => {
  it("accepts a manual entry with null source spans", () => {
    expect(draftCandidateSchema.safeParse(CANDIDATE).success).toBe(true);
  });

  it("rejects an ambiguity flag outside the closed set", () => {
    const parsed = draftCandidateSchema.safeParse({ ...CANDIDATE, ambiguities: ["maybe"] });
    expect(parsed.success).toBe(false);
  });
});

describe("createCaptureRequest", () => {
  it("requires the reviewed entry for a manual capture", () => {
    const missing = createCaptureRequestSchema.safeParse({ ...BASE_REQUEST, inputKind: "manual" });
    expect(missing.success).toBe(false);
    const provided = createCaptureRequestSchema.safeParse({
      ...BASE_REQUEST,
      inputKind: "manual",
      candidates: [CANDIDATE],
    });
    expect(provided.success).toBe(true);
  });

  it("requires the typed text for a text capture", () => {
    const missing = createCaptureRequestSchema.safeParse({ ...BASE_REQUEST, inputKind: "text" });
    expect(missing.success).toBe(false);
    const provided = createCaptureRequestSchema.safeParse({
      ...BASE_REQUEST,
      inputKind: "text",
      text: "Fed 60 ml at two",
    });
    expect(provided.success).toBe(true);
  });

  // Audio needs upload authorization and the worker, which arrive in milestone 3.
  it("rejects an audio capture in this milestone", () => {
    const parsed = createCaptureRequestSchema.safeParse({ ...BASE_REQUEST, inputKind: "audio" });
    expect(parsed.success).toBe(false);
  });
});
