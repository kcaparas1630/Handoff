/**
 * architecture.md section 6: by default every event from one capture references that capture's
 * attachments, and section 5 of docs/experience-design.md asks the brief to show a shared
 * attachment once and link back to the capture. Ready asset ids are therefore per-capture, and the
 * first entry carrying one is the section's representative for it.
 *
 * The result maps each entry key to the ids that entry should draw; later entries from the same
 * capture map to an empty list and keep only their own link to the source.
 */
export function dedupeAttachmentsByCapture(
  entries: readonly { key: string; readyAssetIds: readonly string[] }[],
): Record<string, readonly string[]> {
  const shown = new Set<string>();
  const byEntry: Record<string, readonly string[]> = {};

  for (const entry of entries) {
    const unseen = entry.readyAssetIds.filter((assetId) => !shown.has(assetId));
    for (const assetId of unseen) shown.add(assetId);
    byEntry[entry.key] = unseen;
  }
  return byEntry;
}
