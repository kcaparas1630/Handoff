// Job dedupe keys. They are the semantic identity of a unit of work, so they are built in one
// place: a second enqueue with the same key schedules nothing, which is what makes a retried
// request, a duplicate completion callback, and a daily sweep safe to repeat.

export function processCaptureDedupeKey(captureId: string): string {
  return `process_capture:${captureId}`;
}

/** Keyed by the audit row, so a later failure for the same entity still gets its own job. */
export function reconcileClerkDedupeKey(
  entityType: string,
  entityId: string,
  auditLogId: string,
): string {
  return `reconcile_clerk:${entityType}:${entityId}:${auditLogId}`;
}

/** One audio cleanup per workspace per day; the handler re-enqueues tomorrow's before it exits. */
export function cleanupAudioDedupeKey(workspaceId: string, day: Date): string {
  return `cleanup_audio:${workspaceId}:${day.toISOString().slice(0, 10)}`;
}
