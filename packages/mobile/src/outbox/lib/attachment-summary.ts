import type { OutboxAttachment, OutboxAttachmentSummary } from "../types/attachment";

/**
 * Counts where this account's queued attachments have reached. A row only exists while the file is
 * still Handoff's responsibility, so every row here is something the server has not published.
 */
export function summariseAttachments(
  rows: readonly Pick<OutboxAttachment, "stage">[],
): OutboxAttachmentSummary {
  let savedLocallyCount = 0;
  let awaitingValidationCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    if (row.stage === "failed") failedCount += 1;
    // Until the bytes are accepted the file is only on this phone, whatever else was allocated.
    else if (row.stage === "saved_locally" || row.stage === "asset_created") savedLocallyCount += 1;
    else awaitingValidationCount += 1;
  }

  return {
    localCount: rows.length,
    savedLocallyCount,
    awaitingValidationCount,
    failedCount,
  };
}

/**
 * One sentence for the caregiver, or null when nothing is outstanding. It never claims an
 * attachment is shared: a file is on this phone, waiting for checks, or needs another try.
 */
export function describeAttachmentProgress(summary: OutboxAttachmentSummary): string | null {
  const parts: string[] = [];
  if (summary.savedLocallyCount > 0) {
    parts.push(`${countFiles(summary.savedLocallyCount)} on this phone, not yet shared`);
  }
  if (summary.awaitingValidationCount > 0) {
    parts.push(`${countFiles(summary.awaitingValidationCount)} waiting for checks`);
  }
  if (summary.failedCount > 0) {
    parts.push(`${countFiles(summary.failedCount)} that could not be sent`);
  }
  return parts.length === 0 ? null : `${parts.join(", ")}.`;
}

function countFiles(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}
