// Deterministic synthetic care for the pilot seed. Pure: no clock, no database, no randomness, so
// two runs of `pnpm seed:pilot` produce the same week and a reviewer can predict it.
//
// Nothing here describes a real child. Names are supplied by the caller as "Pilot Child A"-style
// labels; these entries carry only care facts a fixture would contain.
import type {
  AmountUnit,
  EventDetails,
  EventKind,
  TimePrecision,
} from "../../packages/contracts/src/index";

export interface SyntheticEntry {
  kind: EventKind;
  /** Wall-clock hour and minute in the workspace's own time zone. */
  hour: number;
  minute: number;
  timePrecision: TimePrecision;
  amountValue: string | null;
  amountUnit: AmountUnit | null;
  details: EventDetails;
  important: boolean;
}

const feedAmountsMl = ["60", "90", "120", "45", "150", "75"];

/**
 * One child's day. Entries vary by child and by day so the pilot's briefs are not identical, and
 * every seventh entry deliberately has no stated time so the unknown-time path is exercised.
 */
export function syntheticDay(childIndex: number, dayIndex: number): readonly SyntheticEntry[] {
  const seed = childIndex * 7 + dayIndex;
  const entries: SyntheticEntry[] = [
    {
      kind: "feed",
      hour: 8,
      minute: (seed * 5) % 60,
      timePrecision: "exact",
      amountValue: feedAmountsMl[seed % feedAmountsMl.length] ?? "60",
      amountUnit: "ml",
      details: { kind: "feed", method: seed % 3 === 0 ? "breast" : "bottle" },
      important: false,
    },
    {
      kind: "diaper",
      hour: 10,
      minute: (seed * 11) % 60,
      // Every seventh entry is reported without a stated time and must stay unknown.
      timePrecision: seed % 7 === 0 ? "unknown" : "exact",
      amountValue: null,
      amountUnit: null,
      details: {
        kind: "diaper",
        contents: seed % 2 === 0 ? "wet" : "both",
        ...(seed % 4 === 0 ? { quantity: "a lot" } : {}),
      },
      important: false,
    },
    {
      kind: "sleep",
      hour: 12,
      minute: 30,
      timePrecision: "approximate",
      amountValue: String(45 + ((seed * 5) % 60)),
      amountUnit: "minutes",
      details: { kind: "sleep", state: "interval", note: "Settled without help." },
      important: false,
    },
  ];

  // A milestone on the third day of each child's week, and a planned note on the fifth. The note
  // is deliberately a plan: it must never render as completed care.
  if (dayIndex === 2) {
    entries.push({
      kind: "milestone",
      hour: 15,
      minute: 10,
      timePrecision: "exact",
      amountValue: null,
      amountUnit: null,
      details: {
        kind: "milestone",
        description: "Pulled to standing at the low shelf",
        reportedFirst: true,
      },
      important: true,
    });
  }
  if (dayIndex === 4) {
    entries.push({
      kind: "note",
      hour: 16,
      minute: 0,
      timePrecision: "exact",
      amountValue: null,
      amountUnit: null,
      details: {
        kind: "note",
        text: "Bring a spare sun hat tomorrow.",
        intent: "planned",
      },
      important: false,
    });
  }
  return entries;
}

/** The instant an entry is stated to have happened, or null when its time was never stated. */
export function occurrenceFor(
  entry: SyntheticEntry,
  dayStartUtc: Date,
): { occurredAt: string | null; endedAt: string | null } {
  if (entry.timePrecision === "unknown") return { occurredAt: null, endedAt: null };
  const occurredAt = new Date(dayStartUtc);
  occurredAt.setUTCHours(entry.hour, entry.minute, 0, 0);
  if (entry.kind !== "sleep") {
    return { occurredAt: occurredAt.toISOString(), endedAt: null };
  }
  const endedAt = new Date(occurredAt.getTime() + Number(entry.amountValue ?? "45") * 60_000);
  return { occurredAt: occurredAt.toISOString(), endedAt: endedAt.toISOString() };
}
