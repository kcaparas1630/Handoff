import type { AppRole, CaregiverRelationship, ChildPermission, InvitationStatus } from "./enums";

export interface InvitationIntentRow {
  id: string;
  workspaceId: string;
  clerkInvitationId: string | null;
  // Normalized invitee email as a validated ciphertext envelope.
  inviteeCiphertext: unknown;
  emailLookupHash: Uint8Array;
  emailLookupKeyId: string;
  intendedAppRole: AppRole;
  invitedByUserId: string;
  status: InvitationStatus;
  acceptedByUserId: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface NewInvitationIntent {
  id: string;
  workspaceId: string;
  inviteeCiphertext: unknown;
  emailLookupHash: Uint8Array;
  emailLookupKeyId: string;
  intendedAppRole: AppRole;
  invitedByUserId: string;
  expiresAt: Date;
}

export interface InvitationStatusUpdate {
  workspaceId: string;
  invitationId: string;
  expectedVersion: number;
  status: InvitationStatus;
  clerkInvitationId?: string | null;
  acceptedByUserId?: string | null;
  acceptedAt?: Date | null;
}

export interface InvitationChildGrantRow {
  workspaceId: string;
  invitationIntentId: string;
  childId: string;
  relationship: CaregiverRelationship;
  permission: ChildPermission;
  createdAt: Date;
}

export interface NewInvitationChildGrant {
  workspaceId: string;
  invitationIntentId: string;
  childId: string;
  relationship: CaregiverRelationship;
  permission: ChildPermission;
}
