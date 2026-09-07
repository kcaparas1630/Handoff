// Job dedupe keys. They are the semantic identity of a unit of work, so they are built in one
// place: a second enqueue with the same key schedules nothing, which is what makes a retried
// request, a duplicate completion callback, and a daily sweep safe to repeat.

export function processCaptureDedupeKey(captureId: string): string {
  return `process_capture:${captureId}`;
}

/** One validation per uploaded attachment, so a duplicate completion callback queues nothing. */
export function validateMediaDedupeKey(assetId: string): string {
  return `validate_media:${assetId}`;
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

/** One upload sweep per workspace per day; the handler re-enqueues tomorrow's before it exits. */
export function cleanupUploadsDedupeKey(workspaceId: string, day: Date): string {
  return `cleanup_uploads:${workspaceId}:${day.toISOString().slice(0, 10)}`;
}

/** One purge per child, so a repeated delete request schedules the same unit of work. */
export function purgeChildDedupeKey(childId: string): string {
  return `purge_child:${childId}`;
}

export function purgeWorkspaceDedupeKey(workspaceId: string): string {
  return `purge_workspace:${workspaceId}`;
}

/** Keyed by the successor key, so each rotation gets its own re-encryption pass. */
export function rotateDataKeysDedupeKey(keyId: string): string {
  return `rotate_data_keys:${keyId}`;
}
