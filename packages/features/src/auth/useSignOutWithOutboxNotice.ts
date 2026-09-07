import { useApiUserId } from "@handoff/api-client";
import {
  clearClientMetrics,
  deleteAllForUser,
  openOutbox,
  useOutboxAttachments,
  useOutboxCaptures,
} from "@handoff/mobile";
import { useCallback } from "react";

import type { SignOutWithOutboxNotice } from "./types/sign-out-notice";

/**
 * architecture.md section 7: signing out removes this account's local recordings, attachment
 * files, outbox rows, and in-memory counters, after a clear notice about what is still unsent.
 * `deleteAllForUser` removes both tables and unlinks each recording and attachment file from
 * document storage. The app calls Clerk's signOut once `confirmSignOut` resolves, so nothing of
 * this account is left on the phone before another one can sign in.
 */
export function useSignOutWithOutboxNotice(): SignOutWithOutboxNotice {
  const clerkUserId = useApiUserId();
  const recordings = useOutboxCaptures();
  const attachments = useOutboxAttachments();
  const pendingCount = recordings.length + attachments.summary.localCount;

  const confirmSignOut = useCallback(async (): Promise<void> => {
    // Counters carry no ids, but they still describe this account's session and must not survive
    // into the next one.
    clearClientMetrics();
    if (clerkUserId === null) return;
    const db = await openOutbox();
    await deleteAllForUser(db, clerkUserId);
  }, [clerkUserId]);

  return {
    pendingCount,
    noticeMessage:
      pendingCount === 0 ? null : describeUnsent(recordings.length, attachments.summary.localCount),
    confirmSignOut,
  };
}

function describeUnsent(recordingCount: number, attachmentCount: number): string {
  const parts: string[] = [];
  if (recordingCount > 0) {
    parts.push(`${recordingCount} recording${recordingCount === 1 ? "" : "s"}`);
  }
  if (attachmentCount > 0) {
    parts.push(`${attachmentCount} photo or video file${attachmentCount === 1 ? "" : "s"}`);
  }
  const subject = parts.join(" and ");
  const verb = recordingCount + attachmentCount === 1 ? "has" : "have";
  return `${subject} that ${verb} not been sent yet will be deleted from this phone when you sign out.`;
}
