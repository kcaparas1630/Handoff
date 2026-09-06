import type {
  CaregiverRelationship,
  ChildPermission,
  ChildStatus,
  MembershipStatus,
} from "./enums";

export interface ChildRow {
  id: string;
  workspaceId: string;
  // Name and optional birthdate as a validated ciphertext envelope.
  profileCiphertext: unknown;
  createdByUserId: string;
  journalSeq: number;
  status: ChildStatus;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface NewChild {
  id: string;
  workspaceId: string;
  profileCiphertext: unknown;
  createdByUserId: string;
}

export interface ChildProfileUpdate {
  workspaceId: string;
  childId: string;
  expectedVersion: number;
  profileCiphertext: unknown;
}

export interface ChildCaregiverRow {
  workspaceId: string;
  childId: string;
  userId: string;
  relationship: CaregiverRelationship;
  permission: ChildPermission;
  status: MembershipStatus;
  grantedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface UpsertChildCaregiver {
  workspaceId: string;
  childId: string;
  userId: string;
  relationship: CaregiverRelationship;
  permission: ChildPermission;
  grantedByUserId: string;
}
