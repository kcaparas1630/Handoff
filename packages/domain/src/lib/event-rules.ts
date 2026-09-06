import { amountValueSchema } from "@handoff/contracts";
import type { AmountUnit, EventDetails, EventKind } from "@handoff/contracts";
import type {
  CandidateFact,
  EventFieldError,
  EventSemanticsInput,
  EventSemanticsResult,
} from "../types/events";

// Only a feed carries a caregiver-stated amount today. A sleep duration is derived from its
// interval, so an amount there could contradict the recorded times, and the remaining kinds have
// no quantity at all. data-contract.md §3 keeps "minutes" in the stored unit set for later use.
const allowedUnitsByKind: Record<EventKind, readonly AmountUnit[]> = {
  feed: ["ml", "oz", "g"],
  diaper: [],
  sleep: [],
  milestone: [],
  note: [],
};

export function validateEventSemantics(input: EventSemanticsInput): EventSemanticsResult {
  const errors: EventFieldError[] = [];
  if (input.details.kind !== input.kind) {
    errors.push({
      field: "details.kind",
      message: `Details describe a ${input.details.kind} event but the event kind is ${input.kind}`,
    });
  }
  checkAmount(input, errors);
  checkOccurrence(input, errors);
  checkSleepState(input, errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

function checkAmount(input: EventSemanticsInput, errors: EventFieldError[]): void {
  const { amountValue, amountUnit } = input;
  if (amountValue !== null && amountUnit === null) {
    errors.push({ field: "amountUnit", message: "An amount needs its unit" });
  }
  if (amountUnit !== null && amountValue === null) {
    errors.push({ field: "amountValue", message: "A unit needs its amount" });
  }
  if (amountValue !== null && !amountValueSchema.safeParse(amountValue).success) {
    errors.push({
      field: "amountValue",
      message: "Expected a positive decimal amount with up to two decimal places",
    });
  }
  if (amountValue === null && amountUnit === null) return;

  const allowed = allowedUnitsByKind[input.kind];
  if (allowed.length === 0) {
    errors.push({
      field: "amountValue",
      message: `A ${input.kind} event does not record an amount`,
    });
    return;
  }
  if (amountUnit !== null && !allowed.includes(amountUnit)) {
    errors.push({
      field: "amountUnit",
      message: `A ${input.kind} amount must use one of ${allowed.join(", ")}`,
    });
  }
}

function checkOccurrence(input: EventSemanticsInput, errors: EventFieldError[]): void {
  const { occurredAt, endedAt, timePrecision } = input;
  if (occurredAt !== null && Number.isNaN(occurredAt.getTime())) {
    errors.push({ field: "occurredAt", message: "Expected a valid instant" });
    return;
  }
  if (endedAt !== null && Number.isNaN(endedAt.getTime())) {
    errors.push({ field: "endedAt", message: "Expected a valid instant" });
    return;
  }
  // An unstated time stays unstated in both directions; nothing may quietly become "exact".
  if (occurredAt === null && timePrecision !== "unknown") {
    errors.push({
      field: "timePrecision",
      message: "An event without an occurrence time must have unknown precision",
    });
  }
  if (occurredAt !== null && timePrecision === "unknown") {
    errors.push({
      field: "occurredAt",
      message: "Unknown precision cannot carry an occurrence time",
    });
  }
  if (endedAt === null) return;
  if (occurredAt === null) {
    errors.push({ field: "endedAt", message: "An end time needs a start time" });
    return;
  }
  if (endedAt.getTime() < occurredAt.getTime()) {
    errors.push({ field: "endedAt", message: "An end time cannot precede its start time" });
  }
}

function checkSleepState(input: EventSemanticsInput, errors: EventFieldError[]): void {
  if (input.details.kind !== "sleep") return;
  const { state } = input.details;
  if (state === "interval") {
    if (input.occurredAt === null) {
      errors.push({ field: "occurredAt", message: "A sleep interval needs a start time" });
    }
    if (input.endedAt === null) {
      errors.push({ field: "endedAt", message: "A sleep interval needs an end time" });
    }
    return;
  }
  // A reported start or end is one moment; §3 forbids auto-pairing them into an interval.
  if (input.endedAt !== null) {
    errors.push({
      field: "endedAt",
      message: `A reported sleep ${state} records a single time`,
    });
  }
}

// Care that actually happened, as opposed to an intention or a question. The overview and the
// brief use this so a plan is never counted as a completed feed or shown as latest known care.
export function isCompletedCareFact(kind: EventKind, details: EventDetails): boolean {
  if (details.kind !== kind) return false;
  if (details.kind === "note") return details.intent === "observation";
  return true;
}

// The same invariant for an unconfirmed candidate, where negation and plans are ambiguity flags.
export function isCompletedCareCandidate(candidate: CandidateFact): boolean {
  if (candidate.discarded) return false;
  if (candidate.ambiguities.includes("negation")) return false;
  if (candidate.ambiguities.includes("planned")) return false;
  return isCompletedCareFact(candidate.kind, candidate.details);
}
