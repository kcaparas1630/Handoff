import type { AppRole, MembershipStatus } from "./enums";

export interface UserRow {
  id: string;
  clerkUserId: string;
  // Validated ciphertext envelope; the server decrypts it, the database never does.
  profileCiphertext: unknown;
  status: "active" | "deleted";
  processingNoticeVersion: string | null;
  processingNoticeAcceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewUser {
  clerkUserId: string;
  profileCiphertext: unknown;
}

export interface WorkspaceRow {
  id: string;
  clerkOrgId: string;
  kind: "household" | "daycare";
  profileCiphertext: unknown;
  timezone: string;
  status: "active" | "deleting" | "deleted";
  /** When deletion was requested. The scope-key retention window is measured from it. */
  deletedAt: Date | null;
  storageBudgetBytes: number;
  storageReservedBytes: number;
  storageUsedBytes: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface NewWorkspace {
  id: string;
  clerkOrgId: string;
  kind: "household" | "daycare";
  profileCiphertext: unknown;
  timezone: string;
  storageBudgetBytes: number;
}

export interface WorkspaceMembershipRow {
  workspaceId: string;
  userId: string;
  clerkMembershipId: string;
  appRole: AppRole;
  status: MembershipStatus;
  providerVerifiedAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface UpsertMembership {
  workspaceId: string;
  userId: string;
  clerkMembershipId: string;
  appRole: AppRole;
  status: MembershipStatus;
  providerVerifiedAt: Date;
}

export interface MembershipWithWorkspace {
  membership: WorkspaceMembershipRow;
  workspace: WorkspaceRow;
}
