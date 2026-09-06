// Shorthand for "this caregiver manually logged these facts for this child": one manual capture
// through the real create/confirm services, which is the only path that publishes events.
import { randomUUID } from "node:crypto";
import { confirmCapture } from "../../../packages/server/src/services/capture-confirmation";
import { createCapture } from "../../../packages/server/src/services/captures";
import type {
  ConfirmCaptureResponse,
  DraftCandidate,
  EventDetails,
  EventKind,
} from "../../../packages/contracts/src/index";
import type { TestHarness } from "./service-harness";

const detailsByKind: Record<EventKind, EventDetails> = {
  feed: { kind: "feed", method: "bottle" },
  diaper: { kind: "diaper", contents: "wet" },
  sleep: { kind: "sleep", state: "interval" },
  milestone: { kind: "milestone", description: "Rolled over", reportedFirst: false },
  note: { kind: "note", text: "Settled quickly", intent: "observation" },
};

/** A reviewed manual line with a stated time, which every kind accepts unless overridden. */
export function candidate(overrides: Partial<DraftCandidate> = {}): DraftCandidate {
  const kind = overrides.kind ?? "feed";
  const occurredAt = overrides.occurredAt ?? new Date().toISOString();
  return {
    id: randomUUID(),
    kind,
    occurredAt,
    endedAt: null,
    timePrecision: occurredAt === null ? "unknown" : "exact",
    amountValue: null,
    amountUnit: null,
    details: detailsByKind[kind],
    important: false,
    sourceQuote: null,
    sourceStart: null,
    sourceEnd: null,
    ambiguities: [],
    discarded: false,
    ...overrides,
  };
}

export async function confirmManualCapture(
  harness: TestHarness,
  input: {
    actorUserId: string;
    childId: string;
    candidates: DraftCandidate[];
    timezone?: string;
    careSessionId?: string;
  },
): Promise<ConfirmCaptureResponse> {
  const capture = await createCapture({
    deps: harness.deps,
    actorUserId: input.actorUserId,
    input: {
      childId: input.childId,
      clientCaptureId: randomUUID(),
      inputKind: "manual",
      capturedAt: new Date().toISOString(),
      timezone: input.timezone ?? "America/Vancouver",
      locale: "en-CA",
      candidates: input.candidates,
      ...(input.careSessionId === undefined ? {} : { careSessionId: input.careSessionId }),
    },
  });
  return confirmCapture({
    deps: harness.deps,
    actorUserId: input.actorUserId,
    captureId: capture.id,
    input: {
      expectedDraftVersion: capture.draftVersion,
      candidates: input.candidates.map(({ sourceStart: _s, sourceEnd: _e, ...rest }) => rest),
    },
  });
}
