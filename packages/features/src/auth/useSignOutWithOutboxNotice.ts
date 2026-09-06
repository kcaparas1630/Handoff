import { useApiUserId } from "@handoff/api-client";
import { deleteAllForUser, openOutbox, useOutboxCaptures } from "@handoff/mobile";
import { useCallback } from "react";

import type { SignOutWithOutboxNotice } from "./types/sign-out-notice";

/**
 * architecture.md section 7: signing out removes this account's local recordings and outbox, after
 * a clear notice about what is still unsent. The app calls Clerk's signOut once `confirmSignOut`
 * resolves, so the files are gone before another account can sign in.
 */
export function useSignOutWithOutboxNotice(): SignOutWithOutboxNotice {
  const clerkUserId = useApiUserId();
  const rows = useOutboxCaptures();
  const pendingCount = rows.length;

  const confirmSignOut = useCallback(async (): Promise<void> => {
    if (clerkUserId === null) return;
    const db = await openOutbox();
    await deleteAllForUser(db, clerkUserId);
  }, [clerkUserId]);

  return {
    pendingCount,
    noticeMessage: pendingCount === 0 ? null : describeUnsent(pendingCount),
    confirmSignOut,
  };
}

function describeUnsent(count: number): string {
  const subject = count === 1 ? "recording that has" : "recordings that have";
  return `${count} ${subject} not been sent yet will be deleted from this phone when you sign out.`;
}
