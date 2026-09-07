// In-memory Clerk gateway for integration tests. Nothing here touches the network.
import { randomUUID } from "node:crypto";
import type { WebhookEvent } from "@clerk/backend";
import type {
  ClerkGateway,
  ClerkMembership,
  CreateClerkInvitationInput,
} from "../../../packages/server/src/types/clerk";

export type FakeClerkOperation =
  | "verifySessionToken"
  | "getOrganizationMembership"
  | "listUserOrganizationMemberships"
  | "getUserPrimaryEmail"
  | "createOrganizationInvitation"
  | "revokeOrganizationInvitation"
  | "removeOrganizationMember"
  | "deleteOrganization"
  | "verifyWebhook";

export interface FakeClerkCall {
  operation: FakeClerkOperation;
  input: unknown;
}

export interface FakeClerkInvitation {
  clerkInvitationId: string;
  clerkOrgId: string;
  email: string;
  role: string;
  intentId: string;
  status: "pending" | "revoked";
}

export interface FakeClerkGateway extends ClerkGateway {
  calls: FakeClerkCall[];
  invitations: FakeClerkInvitation[];
  /** Organizations the server asked Clerk to delete, in order. */
  deletedOrganizations: string[];
  setUser(clerkUserId: string, primaryEmail: string | null): void;
  setMembership(membership: ClerkMembership): void;
  deleteMembership(clerkOrgId: string, clerkUserId: string): void;
  /** Makes the next calls to `operation` fail, standing in for a timeout or provider outage. */
  failOperation(operation: FakeClerkOperation): void;
  clearFailures(): void;
  callsTo(operation: FakeClerkOperation): FakeClerkCall[];
}

function membershipKey(clerkOrgId: string, clerkUserId: string): string {
  return `${clerkOrgId}::${clerkUserId}`;
}

export function createFakeClerkGateway(): FakeClerkGateway {
  const users = new Map<string, string | null>();
  const memberships = new Map<string, ClerkMembership>();
  const failing = new Set<FakeClerkOperation>();
  const calls: FakeClerkCall[] = [];
  const invitations: FakeClerkInvitation[] = [];
  const deletedOrganizations: string[] = [];

  function record(operation: FakeClerkOperation, input: unknown): void {
    calls.push({ operation, input });
    if (failing.has(operation)) throw new Error(`fake clerk ${operation} is failing`);
  }

  return {
    calls,
    invitations,
    deletedOrganizations,

    setUser(clerkUserId, primaryEmail) {
      users.set(clerkUserId, primaryEmail);
    },
    setMembership(membership) {
      memberships.set(membershipKey(membership.clerkOrgId, membership.clerkUserId), membership);
    },
    deleteMembership(clerkOrgId, clerkUserId) {
      memberships.delete(membershipKey(clerkOrgId, clerkUserId));
    },
    failOperation(operation) {
      failing.add(operation);
    },
    clearFailures() {
      failing.clear();
    },
    callsTo(operation) {
      return calls.filter((call) => call.operation === operation);
    },

    // The token is the Clerk subject: signature verification itself is Clerk's job, tested there.
    verifySessionToken(token) {
      record("verifySessionToken", { token });
      return Promise.resolve({ clerkUserId: token });
    },

    getOrganizationMembership({ clerkOrgId, clerkUserId }) {
      record("getOrganizationMembership", { clerkOrgId, clerkUserId });
      return Promise.resolve(memberships.get(membershipKey(clerkOrgId, clerkUserId)) ?? null);
    },

    listUserOrganizationMemberships(clerkUserId) {
      record("listUserOrganizationMemberships", { clerkUserId });
      return Promise.resolve(
        [...memberships.values()].filter((membership) => membership.clerkUserId === clerkUserId),
      );
    },

    getUserPrimaryEmail(clerkUserId) {
      record("getUserPrimaryEmail", { clerkUserId });
      return Promise.resolve(users.get(clerkUserId) ?? null);
    },

    createOrganizationInvitation(input: CreateClerkInvitationInput) {
      record("createOrganizationInvitation", input);
      const clerkInvitationId = `orginv_${randomUUID()}`;
      invitations.push({
        clerkInvitationId,
        clerkOrgId: input.clerkOrgId,
        email: input.email,
        role: input.role,
        intentId: input.publicMetadata.intentId,
        status: "pending",
      });
      return Promise.resolve({ clerkInvitationId });
    },

    revokeOrganizationInvitation({ clerkOrgId, clerkInvitationId }) {
      record("revokeOrganizationInvitation", { clerkOrgId, clerkInvitationId });
      const invitation = invitations.find(
        (candidate) => candidate.clerkInvitationId === clerkInvitationId,
      );
      if (invitation !== undefined) invitation.status = "revoked";
      return Promise.resolve();
    },

    removeOrganizationMember({ clerkOrgId, clerkUserId }) {
      record("removeOrganizationMember", { clerkOrgId, clerkUserId });
      memberships.delete(membershipKey(clerkOrgId, clerkUserId));
      return Promise.resolve();
    },

    deleteOrganization({ clerkOrgId }) {
      record("deleteOrganization", { clerkOrgId });
      deletedOrganizations.push(clerkOrgId);
      for (const key of [...memberships.keys()]) {
        if (key.startsWith(`${clerkOrgId}::`)) memberships.delete(key);
      }
      return Promise.resolve();
    },

    async verifyWebhook(request: Request): Promise<WebhookEvent> {
      record("verifyWebhook", { url: request.url });
      // Tests post the already-signed event body; failOperation stands in for a bad signature.
      return (await request.json()) as WebhookEvent;
    },
  };
}
