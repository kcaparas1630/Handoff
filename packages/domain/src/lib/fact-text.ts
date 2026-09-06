import type { EventKind } from "@handoff/contracts";
import type { FactTextFields } from "../types/brief";
import { formatWallClock, formatWallDate, wallDayDifference } from "./zoned-time";

// Deterministic one-line templates. They state only what was recorded: a missing amount stays
// "not recorded", a missing time stays "not given", and a plan is never phrased as care given.
export function renderFactText(kind: EventKind, fields: FactTextFields, timezone: string): string {
  const { details } = fields;
  if (details.kind !== kind) return "Entry could not be rendered";

  if (details.kind === "feed") {
    const amount = formatAmount(fields);
    const qualifiers: string[] = [];
    if (details.method !== "unknown") qualifiers.push(details.method);
    if (amount === null) qualifiers.push("amount not recorded");
    const head = `Fed${amount === null ? "" : ` ${amount}`}${renderQualifiers(qualifiers)}`;
    return withSuffix(head + timeClause(fields, timezone), details.description);
  }

  if (details.kind === "diaper") {
    const head = `${diaperSubjects[details.contents]}${renderQualifiers(quantityOf(details.quantity))}`;
    return withSuffix(head + timeClause(fields, timezone), details.note);
  }

  if (details.kind === "sleep") {
    return withSuffix(sleepHead(fields, details.state, timezone), details.note);
  }

  if (details.kind === "milestone") {
    const lead = details.reportedFirst ? "Milestone (reported as a first)" : "Milestone";
    const quoted = details.quote === undefined ? "" : ` \u2014 \u201c${details.quote}\u201d`;
    return `${lead}: ${details.description}${quoted}${timeClause(fields, timezone)}`;
  }

  if (details.intent === "observation") {
    return `Note: ${details.text}${timeClause(fields, timezone)}`;
  }
  // A plan or a question never takes an "at <time>" clause; that would read as completed care.
  const label = details.intent === "planned" ? "Plan" : "Question";
  const when = intendedClause(fields, timezone);
  return `${label}: ${details.text}${when}`;
}

// "2 h ago" / "yesterday 14:10" for latest-known context; null occurrence stays unranked.
export function renderAgeLabel(instant: Date | null, now: Date, timezone: string): string {
  if (instant === null) return "time not given";
  const elapsedMs = now.getTime() - instant.getTime();
  if (elapsedMs < 0) return `at ${formatWallClock(instant, timezone)}`;
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const dayDifference = wallDayDifference(instant, now, timezone);
  if (dayDifference === 0) return `${Math.floor(minutes / 60)} h ago`;
  if (dayDifference === 1) return `yesterday ${formatWallClock(instant, timezone)}`;
  return `${formatWallDate(instant, timezone)} ${formatWallClock(instant, timezone)}`;
}

const diaperSubjects = {
  wet: "Wet diaper",
  stool: "Stool diaper",
  both: "Wet and stool diaper",
  unknown: "Diaper change",
} as const;

function timeClause(fields: FactTextFields, timezone: string): string {
  if (fields.occurredAt === null || fields.timePrecision === "unknown") {
    return `, reported ${formatWallClock(fields.reportedAt, timezone)}, time not given`;
  }
  const at = formatWallClock(fields.occurredAt, timezone);
  return fields.timePrecision === "approximate" ? ` around ${at}` : ` at ${at}`;
}

function intendedClause(fields: FactTextFields, timezone: string): string {
  if (fields.occurredAt === null || fields.timePrecision === "unknown") return "";
  return ` (for ${formatWallClock(fields.occurredAt, timezone)})`;
}

function sleepHead(fields: FactTextFields, state: string, timezone: string): string {
  if (state === "interval" && fields.occurredAt !== null && fields.endedAt !== null) {
    const start = formatWallClock(fields.occurredAt, timezone);
    const end = formatWallClock(fields.endedAt, timezone);
    return `Slept ${start}\u2013${end}`;
  }
  if (state === "started") return `Sleep started${timeClause(fields, timezone)}`;
  if (state === "ended") return `Sleep ended${timeClause(fields, timezone)}`;
  return `Slept${timeClause(fields, timezone)}`;
}

// Amount strings are stored at two decimals; trailing zeros are display noise, not a value change.
function formatAmount(fields: FactTextFields): string | null {
  if (fields.amountValue === null || fields.amountUnit === null) return null;
  const trimmed = fields.amountValue.includes(".")
    ? fields.amountValue.replace(/0+$/, "").replace(/\.$/, "")
    : fields.amountValue;
  return `${trimmed} ${fields.amountUnit}`;
}

function quantityOf(quantity: string | undefined): string[] {
  return quantity === undefined ? [] : [quantity];
}

function renderQualifiers(qualifiers: readonly string[]): string {
  return qualifiers.length === 0 ? "" : ` (${qualifiers.join(", ")})`;
}

function withSuffix(text: string, suffix: string | undefined): string {
  return suffix === undefined ? text : `${text}, ${suffix}`;
}
