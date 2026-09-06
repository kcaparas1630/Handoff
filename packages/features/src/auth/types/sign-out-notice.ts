export type SignOutWithOutboxNotice = {
  /** Recordings this account has on the phone that the server has not acknowledged yet. */
  pendingCount: number;
  /** The sentence to show before signing out; null when nothing would be lost. */
  noticeMessage: string | null;
  /** Removes this account's outbox rows and recordings. Call Clerk's signOut after it resolves. */
  confirmSignOut: () => Promise<void>;
};
