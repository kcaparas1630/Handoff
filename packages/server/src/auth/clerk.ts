// The single adapter between Handoff and Clerk. Provider errors never reach a caller verbatim.
import { createClerkClient, verifyToken } from "@clerk/backend";
import { verifyWebhook } from "@clerk/backend/webhooks";
import type { ClerkClient, OrganizationMembership, WebhookEvent } from "@clerk/backend";
import { ApiHttpError } from "../http/errors";
import type {
  ClerkGateway,
  ClerkMembership,
  ClerkSubject,
  CreateClerkInvitationInput,
} from "../types/clerk";

/** Bootstrap reconciles at most this many organizations in one call. */
const MEMBERSHIP_PAGE_LIMIT = 20;

function toMembership(membership: OrganizationMembership): ClerkMembership | null {
  const clerkUserId = membership.publicUserData?.userId;
  if (clerkUserId === undefined) return null;
  return {
    clerkMembershipId: membership.id,
    clerkOrgId: membership.organization.id,
    clerkUserId,
    role: membership.role,
  };
}

async function callProvider<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    // The SDK error can quote the request, which carries emails; only the code escapes.
    throw ApiHttpError.providerUnavailable("Clerk did not complete the request");
  }
}

export function createClerkGateway({
  secretKey,
  webhookSigningSecret,
  /** Accepted `azp` values. Omitted leaves Clerk's own default, which accepts any party. */
  authorizedParties,
  client = createClerkClient({ secretKey }),
}: {
  secretKey: string;
  webhookSigningSecret: string;
  authorizedParties?: string[];
  client?: ClerkClient;
}): ClerkGateway {
  return {
    async verifySessionToken(token: string): Promise<ClerkSubject> {
      let subject: string | undefined;
      try {
        // Binding the authorized party is what stops a token minted for another application
        // from being replayed against this API.
        const payload = await verifyToken(token, {
          secretKey,
          ...(authorizedParties === undefined ? {} : { authorizedParties }),
        });
        subject = payload.sub;
      } catch {
        throw ApiHttpError.unauthorized("The session token is not valid");
      }
      if (subject === undefined || subject === "") {
        throw ApiHttpError.unauthorized("The session token has no subject");
      }
      return { clerkUserId: subject };
    },

    async getOrganizationMembership({ clerkOrgId, clerkUserId }): Promise<ClerkMembership | null> {
      const page = await callProvider(() =>
        client.organizations.getOrganizationMembershipList({
          organizationId: clerkOrgId,
          userId: [clerkUserId],
          limit: 1,
        }),
      );
      const [membership] = page.data;
      return membership === undefined ? null : toMembership(membership);
    },

    async listUserOrganizationMemberships(clerkUserId: string): Promise<ClerkMembership[]> {
      const page = await callProvider(() =>
        client.users.getOrganizationMembershipList({
          userId: clerkUserId,
          limit: MEMBERSHIP_PAGE_LIMIT,
        }),
      );
      return page.data.flatMap((membership) => {
        const mapped = toMembership(membership);
        return mapped === null ? [] : [mapped];
      });
    },

    async getUserPrimaryEmail(clerkUserId: string): Promise<string | null> {
      const user = await callProvider(() => client.users.getUser(clerkUserId));
      const primary = user.emailAddresses.find(
        (address) => address.id === user.primaryEmailAddressId,
      );
      return primary?.emailAddress ?? null;
    },

    async createOrganizationInvitation(
      input: CreateClerkInvitationInput,
    ): Promise<{ clerkInvitationId: string }> {
      const invitation = await callProvider(() =>
        client.organizations.createOrganizationInvitation({
          organizationId: input.clerkOrgId,
          emailAddress: input.email,
          role: input.role,
          redirectUrl: input.redirectUrl,
          publicMetadata: input.publicMetadata,
        }),
      );
      return { clerkInvitationId: invitation.id };
    },

    async revokeOrganizationInvitation({ clerkOrgId, clerkInvitationId }): Promise<void> {
      await callProvider(() =>
        client.organizations.revokeOrganizationInvitation({
          organizationId: clerkOrgId,
          invitationId: clerkInvitationId,
        }),
      );
    },

    async removeOrganizationMember({ clerkOrgId, clerkUserId }): Promise<void> {
      await callProvider(() =>
        client.organizations.deleteOrganizationMembership({
          organizationId: clerkOrgId,
          userId: clerkUserId,
        }),
      );
    },

    async deleteOrganization({ clerkOrgId }): Promise<void> {
      await callProvider(() => client.organizations.deleteOrganization(clerkOrgId));
    },

    async verifyWebhook(request: Request): Promise<WebhookEvent> {
      try {
        return await verifyWebhook(request, { signingSecret: webhookSigningSecret });
      } catch {
        throw ApiHttpError.unauthorized("The webhook signature is not valid");
      }
    },
  };
}
