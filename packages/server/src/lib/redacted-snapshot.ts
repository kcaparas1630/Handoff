// What a purged child's brief snapshot becomes. The row stays as the record that this recipient
// acknowledged a handoff at this cursor position; the care it described does not.
import type { BriefSnapshot } from "@handoff/contracts";

export interface RedactedSnapshotSource {
  rendererVersion: string;
  fromSeqExclusive: number;
  throughSeqInclusive: number;
  initialWindowStart: Date | null;
}

/**
 * A valid, empty snapshot rather than a null column: a reader still parses it with the ordinary
 * schema and sees a brief with no entries and no sources, and the boundary the row already
 * records stays readable for the audit trail.
 */
export function redactedBriefSnapshot(
  source: RedactedSnapshotSource,
  generatedAt: Date,
): BriefSnapshot {
  return {
    schemaVersion: 1,
    rendererVersion: source.rendererVersion,
    boundary: {
      fromSeqExclusive: source.fromSeqExclusive,
      throughSeqInclusive: source.throughSeqInclusive,
      initialWindowStart: source.initialWindowStart?.toISOString() ?? null,
      label: "Removed",
    },
    essentials: [],
    updates: [],
    moments: [],
    pendingCaptureCount: 0,
    sourceRevisionIds: [],
    generatedAt: generatedAt.toISOString(),
  };
}
