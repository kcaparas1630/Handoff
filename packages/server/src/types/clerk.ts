// The only shape of Clerk the services see. Tests substitute an in-memory gateway.
import type { WebhookEvent } from "@clerk/backend";
import type { AppRole } from "@handoff/contracts";

export interface ClerkSubject {
  clerkUserId: string;
}

export interface ClerkMembership {
  clerkMembershipId: string;
  clerkOrgId: string;
  clerkUserId: string;
  /** Provider role string such as `org:admin`; mapped to an app role server-side. */
  role: string;
}

export interface CreateClerkInvitationInput {
  clerkOrgId: string;
  email: string;
  role: string;
  redirectUrl: string;
  /** Clerk carries only the opaque intent id; it never carries child grants or authority. */
  publicMetadata: { intentId: string };
}

export interface ClerkGateway {
  verifySessionToken(token: string): Promise<ClerkSubject>;
  getOrganizationMembership(input: {
    clerkOrgId: string;
    clerkUserId: string;
  }): Promise<ClerkMembership | null>;
  listUserOrganizationMemberships(clerkUserId: string): Promise<ClerkMembership[]>;
  /** Recipient verification for invitation acceptance; a matching hash alone never grants. */
  getUserPrimaryEmail(clerkUserId: string): Promise<string | null>;
  createOrganizationInvitation(
    input: CreateClerkInvitationInput,
  ): Promise<{ clerkInvitationId: string }>;
  revokeOrganizationInvitation(input: {
    clerkOrgId: string;
    clerkInvitationId: string;
  }): Promise<void>;
  removeOrganizationMember(input: { clerkOrgId: string; clerkUserId: string }): Promise<void>;
  verifyWebhook(request: Request): Promise<WebhookEvent>;
}

export interface MapClerkRoleInput {
  clerkRole: string;
  /** The stored invitation's intended role, when this membership came from one. */
  intendedAppRole: AppRole | null;
  guardianRoleKey: string;
}
