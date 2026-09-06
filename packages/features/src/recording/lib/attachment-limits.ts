import { MAX_ATTACHMENTS_PER_CAPTURE } from "@handoff/contracts";

/**
 * How many more files this capture can take. architecture.md section 6 caps a capture at three
 * attachments and the server enforces it; this only stops the UI from inviting a fourth.
 *
 * `serverCount` is derived from the capture's published `readyAssetIds`, so a file that has left
 * the outbox but is still being validated is counted by neither side for a short window. The
 * server refuses the extra request in that case, which is why this is a hint and not the rule.
 */
export function remainingAttachmentSlots(localCount: number, serverCount: number): number {
  const used = Math.max(0, localCount) + Math.max(0, serverCount);
  return Math.max(0, MAX_ATTACHMENTS_PER_CAPTURE - used);
}

/** The sentence shown when there is no room left, so the limit is stated before a pick fails. */
export function describeAttachmentLimit(remaining: number): string {
  if (remaining > 0) {
    return `You can add ${remaining} more file${remaining === 1 ? "" : "s"} to this update.`;
  }
  return `This update already has the maximum of ${MAX_ATTACHMENTS_PER_CAPTURE} files.`;
}
