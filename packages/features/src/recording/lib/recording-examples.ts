/**
 * Short task-relevant examples shown next to the Record control (experience-design.md section 3).
 * They describe what can be said; they never suggest that speaking publishes anything.
 */
export const recordingExamples: readonly string[] = [
  "Fed 60 ml at two, then had a wet diaper.",
  "Napped from eight to twenty to nine.",
  "First word today — she said Dada.",
];

export const exampleRotationMs = 6_000;

export function exampleAt(index: number): string {
  const first = recordingExamples[0] ?? "";
  if (recordingExamples.length === 0) return first;
  const wrapped =
    ((index % recordingExamples.length) + recordingExamples.length) % recordingExamples.length;
  return recordingExamples[wrapped] ?? first;
}

/** mm:ss for the elapsed time readout; the limit makes anything longer impossible. */
export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
