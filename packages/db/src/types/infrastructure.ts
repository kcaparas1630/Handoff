export interface IdempotencyRequestRow {
  actorUserId: string;
  operation: string;
  key: string;
  scopeKind: "workspace" | "user";
  scopeWorkspaceId: string | null;
  requestFingerprint: Uint8Array;
  fingerprintKeyId: string;
  responseStatus: number;
  // Canonical response fields as a ciphertext envelope; null when nothing had to be retained.
  responseCiphertext: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export interface NewIdempotencyRequest {
  actorUserId: string;
  operation: string;
  key: string;
  scopeKind: "workspace" | "user";
  scopeWorkspaceId: string | null;
  requestFingerprint: Uint8Array;
  fingerprintKeyId: string;
  responseStatus: number;
  responseCiphertext: unknown;
  expiresAt: Date;
}

export interface WebhookInboxRow {
  provider: string;
  eventId: string;
  eventType: string;
  clerkOrgId: string | null;
  clerkUserId: string | null;
  clerkMembershipId: string | null;
  clerkInvitationId: string | null;
  receivedAt: Date;
  status: "received" | "processed" | "failed";
  processedAt: Date | null;
  retryCount: number;
}

export interface NewWebhookInboxEntry {
  provider: string;
  eventId: string;
  eventType: string;
  clerkOrgId?: string | null;
  clerkUserId?: string | null;
  clerkMembershipId?: string | null;
  clerkInvitationId?: string | null;
}

export interface AuditLogRow {
  id: string;
  workspaceId: string | null;
  childId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string;
  createdAt: Date;
}

export interface NewAuditLogEntry {
  workspaceId?: string | null;
  childId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId: string;
}
