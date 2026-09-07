import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../packages/db/src/client";
import { createDataKeyStore } from "../../packages/db/src/repositories/data-keys";
import { ApiHttpError } from "../../packages/server/src/http/errors";
import { createDataKeyService } from "../../packages/server/src/security/encryption/data-keys";
import { createDevelopmentKeyWrapper } from "../../packages/server/src/security/encryption/development-key-wrapper";
import { bootstrap } from "../../packages/server/src/services/bootstrap";
import { createChild } from "../../packages/server/src/services/children";
import { listChildCaregivers } from "../../packages/server/src/services/child-caregivers";
import { handleClerkWebhook } from "../../packages/server/src/services/clerk-webhooks";
import {
  createInvitation,
  getInvitation,
  listInvitations,
  revokeInvitation,
} from "../../packages/server/src/services/invitations";
import { revokeMember } from "../../packages/server/src/services/memberships";
import { initializeWorkspace } from "../../packages/server/src/services/workspaces";
import type { DbClient } from "../../packages/db/src/client";
import type { ServiceDeps } from "../../packages/server/src/types/runtime";
import type { FakeClerkGateway } from "./support/fake-clerk-gateway";
import { createFakeClerkGateway } from "./support/fake-clerk-gateway";
import type { TestDatabase } from "./support/test-database";
import { createTestDatabase, missingDatabaseUrlMessage } from "./support/test-database";
import { testObservability } from "./support/observability";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping invitation tests. ${missingDatabaseUrlMessage}`);

const GUARDIAN_ROLE_KEY = "org:guardian";
const ORG_ID = "org_invites";

function membershipEvent(input: {
  clerkUserId: string;
  clerkMembershipId: string;
  role: string;
  intentId?: string;
}): unknown {
  return {
    type: "organizationMembership.created",
    object: "event",
    data: {
      id: input.clerkMembershipId,
      organization: { id: ORG_ID },
      public_user_data: { user_id: input.clerkUserId },
      role: input.role,
      public_metadata: input.intentId === undefined ? {} : { intentId: input.intentId },
    },
  };
}

function webhookRequest(event: unknown, deliveryId: string): Request {
  return new Request("https://handoff.test/v1/webhooks/clerk", {
    method: "POST",
    headers: { "content-type": "application/json", "svix-id": deliveryId },
    body: JSON.stringify(event),
  });
}

async function expectApiError(run: () => Promise<unknown>): Promise<ApiHttpError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiHttpError) return error;
    throw error;
  }
  throw new Error("expected the operation to fail");
}

describeIntegration("invitations", () => {
  let database: TestDatabase;
  let api: DbClient;
  let clerk: FakeClerkGateway;
  let deps: ServiceDeps;
  let workspaceId: string;
  let ownerId: string;
  let childId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    api = createDbClient({ url: database.apiUrl, maxConnections: 10 });
    clerk = createFakeClerkGateway();
    const keyWrapper = createDevelopmentKeyWrapper(randomBytes(32).toString("base64"));
    deps = {
      db: api.db,
      keys: createDataKeyService({ store: createDataKeyStore(api.db), wrapper: keyWrapper }),
      keyWrapper,
      clerk,
      guardianRoleKey: GUARDIAN_ROLE_KEY,
      invitationRedirectUrl: "https://handoff.test/accept-invitation",
      storage: null,
      jobsDb: null,
      ...testObservability(),
      requestId: randomUUID(),
      now: () => new Date(),
    };

    clerk.setUser("user_owner", "owner@example.test");
    const owner = await bootstrap({ deps, clerkUserId: "user_owner", displayName: "Owner" });
    ownerId = owner.user.id;
    clerk.setMembership({
      clerkOrgId: ORG_ID,
      clerkUserId: "user_owner",
      clerkMembershipId: "orgmem_owner",
      role: "org:admin",
    });
    const workspace = await initializeWorkspace({
      deps,
      userId: ownerId,
      clerkUserId: "user_owner",
      input: { clerkOrgId: ORG_ID, kind: "daycare", name: "Invite House", timezone: "UTC" },
    });
    workspaceId = workspace.id;
    const child = await createChild({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: { name: "Ivy" },
    });
    childId = child.id;
  }, 90_000);

  afterAll(async () => {
    await api?.close();
    await database?.drop();
  });

  it("persists the intent, sends through Clerk, and records the provider id", async () => {
    const invitation = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: {
        email: "sent@example.test",
        intendedAppRole: "guardian",
        childGrants: [{ childId, relationship: "parent", permission: "reader" }],
      },
    });
    expect(invitation.status).toBe("sent");
    const sent = clerk.invitations.find((row) => row.intentId === invitation.id);
    expect(sent?.email).toBe("sent@example.test");
    expect(sent?.role).toBe(GUARDIAN_ROLE_KEY);

    const detail = await getInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      invitationId: invitation.id,
    });
    expect(detail.inviteeEmail).toBe("sent@example.test");
  });

  it("returns the existing open intent instead of a duplicate", async () => {
    const first = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: {
        email: "twice@example.test",
        intendedAppRole: "caregiver",
        childGrants: [{ childId, relationship: "caregiver", permission: "contributor" }],
      },
    });
    const second = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: {
        email: "  TWICE@Example.Test ",
        intendedAppRole: "caregiver",
        childGrants: [{ childId, relationship: "caregiver", permission: "contributor" }],
      },
    });
    expect(second.id).toBe(first.id);
    const created = clerk.invitations.filter((row) => row.intentId === first.id);
    expect(created).toHaveLength(1);
  });

  it("records reconcile_needed when the provider call fails", async () => {
    clerk.failOperation("createOrganizationInvitation");
    const invitation = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: {
        email: "timeout@example.test",
        intendedAppRole: "caregiver",
        childGrants: [{ childId, relationship: "caregiver", permission: "contributor" }],
      },
    });
    clerk.clearFailures();
    expect(invitation.status).toBe("reconcile_needed");
  });

  it("applies grants once when the invited person bootstraps", async () => {
    const invitation = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: {
        email: "newbie@example.test",
        intendedAppRole: "guardian",
        childGrants: [{ childId, relationship: "parent", permission: "reader" }],
      },
    });
    clerk.setUser("user_newbie", "Newbie@Example.Test");
    clerk.setMembership({
      clerkOrgId: ORG_ID,
      clerkUserId: "user_newbie",
      clerkMembershipId: "orgmem_newbie",
      role: GUARDIAN_ROLE_KEY,
    });

    const joined = await bootstrap({ deps, clerkUserId: "user_newbie", displayName: "Newbie" });
    expect(joined.workspaces.map((workspace) => workspace.appRole)).toEqual(["guardian"]);

    const caregivers = await listChildCaregivers({
      deps,
      actorUserId: ownerId,
      workspaceId,
      childId,
    });
    const applied = caregivers.filter((row) => row.userId === joined.user.id);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.permission).toBe("reader");

    const invitations = await listInvitations({ deps, actorUserId: ownerId, workspaceId });
    expect(invitations.find((row) => row.id === invitation.id)?.status).toBe("accepted");
  });

  it("collapses ten webhook deliveries into one membership and grant set", async () => {
    const invitation = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: {
        email: "repeat@example.test",
        intendedAppRole: "caregiver",
        childGrants: [{ childId, relationship: "caregiver", permission: "contributor" }],
      },
    });
    clerk.setUser("user_repeat", "repeat@example.test");
    clerk.setMembership({
      clerkOrgId: ORG_ID,
      clerkUserId: "user_repeat",
      clerkMembershipId: "orgmem_repeat",
      role: "org:member",
    });
    const joined = await bootstrap({ deps, clerkUserId: "user_repeat" });

    const event = membershipEvent({
      clerkUserId: "user_repeat",
      clerkMembershipId: "orgmem_repeat",
      role: "org:member",
      intentId: invitation.id,
    });
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await handleClerkWebhook({
        deps,
        request: webhookRequest(event, `svix_repeat_${String(attempt)}`),
      });
      outcomes.push(result.outcome);
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await handleClerkWebhook({
        deps,
        request: webhookRequest(event, "svix_repeat_same"),
      });
      outcomes.push(result.outcome);
    }
    expect(outcomes.filter((outcome) => outcome === "processed")).toHaveLength(6);
    expect(outcomes.filter((outcome) => outcome === "duplicate")).toHaveLength(4);

    const caregivers = await listChildCaregivers({
      deps,
      actorUserId: ownerId,
      workspaceId,
      childId,
    });
    const applied = caregivers.filter((row) => row.userId === joined.user.id);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.permission).toBe("contributor");
  });

  it("does not grant when a different recipient accepts the intent", async () => {
    const invitation = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: {
        email: "intended@example.test",
        intendedAppRole: "caregiver",
        childGrants: [{ childId, relationship: "caregiver", permission: "contributor" }],
      },
    });
    clerk.setUser("user_impostor", "impostor@example.test");
    clerk.setMembership({
      clerkOrgId: ORG_ID,
      clerkUserId: "user_impostor",
      clerkMembershipId: "orgmem_impostor",
      role: "org:member",
    });
    const impostor = await bootstrap({ deps, clerkUserId: "user_impostor" });

    const result = await handleClerkWebhook({
      deps,
      request: webhookRequest(
        membershipEvent({
          clerkUserId: "user_impostor",
          clerkMembershipId: "orgmem_impostor",
          role: "org:member",
          intentId: invitation.id,
        }),
        "svix_impostor",
      ),
    });
    expect(result.outcome).toBe("processed");

    const caregivers = await listChildCaregivers({
      deps,
      actorUserId: ownerId,
      workspaceId,
      childId,
    });
    expect(caregivers.some((row) => row.userId === impostor.user.id)).toBe(false);
    const invitations = await listInvitations({ deps, actorUserId: ownerId, workspaceId });
    expect(invitations.find((row) => row.id === invitation.id)?.status).toBe("sent");
  });

  it("does not grant after the intent was revoked locally", async () => {
    const invitation = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: {
        email: "revoked@example.test",
        intendedAppRole: "caregiver",
        childGrants: [{ childId, relationship: "caregiver", permission: "contributor" }],
      },
    });
    const cancelled = await revokeInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      invitationId: invitation.id,
    });
    expect(cancelled.status).toBe("revoked");

    clerk.setUser("user_late", "revoked@example.test");
    clerk.setMembership({
      clerkOrgId: ORG_ID,
      clerkUserId: "user_late",
      clerkMembershipId: "orgmem_late",
      role: "org:member",
    });
    const late = await bootstrap({ deps, clerkUserId: "user_late" });
    await handleClerkWebhook({
      deps,
      request: webhookRequest(
        membershipEvent({
          clerkUserId: "user_late",
          clerkMembershipId: "orgmem_late",
          role: "org:member",
          intentId: invitation.id,
        }),
        "svix_late",
      ),
    });

    const caregivers = await listChildCaregivers({
      deps,
      actorUserId: ownerId,
      workspaceId,
      childId,
    });
    expect(caregivers.some((row) => row.userId === late.user.id)).toBe(false);
  });

  it("does not grant after the intent expired", async () => {
    const invitation = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: {
        email: "expired@example.test",
        intendedAppRole: "caregiver",
        childGrants: [{ childId, relationship: "caregiver", permission: "contributor" }],
      },
    });
    clerk.setUser("user_expired", "expired@example.test");
    clerk.setMembership({
      clerkOrgId: ORG_ID,
      clerkUserId: "user_expired",
      clerkMembershipId: "orgmem_expired",
      role: "org:member",
    });
    // Eight days later the local expiry applies, whatever the provider still allows.
    const laterDeps: ServiceDeps = {
      ...deps,
      now: () => new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    };
    const invitee = await bootstrap({ deps: laterDeps, clerkUserId: "user_expired" });

    await handleClerkWebhook({
      deps: laterDeps,
      request: webhookRequest(
        membershipEvent({
          clerkUserId: "user_expired",
          clerkMembershipId: "orgmem_expired",
          role: "org:member",
          intentId: invitation.id,
        }),
        "svix_expired",
      ),
    });

    const caregivers = await listChildCaregivers({
      deps,
      actorUserId: ownerId,
      workspaceId,
      childId,
    });
    expect(caregivers.some((row) => row.userId === invitee.user.id)).toBe(false);
    const invitations = await listInvitations({ deps, actorUserId: ownerId, workspaceId });
    expect(invitations.find((row) => row.id === invitation.id)?.status).toBe("expired");
  });

  it("closes child grants when a member is revoked and keeps the last owner", async () => {
    const caregiversBefore = await listChildCaregivers({
      deps,
      actorUserId: ownerId,
      workspaceId,
      childId,
    });
    const active = caregiversBefore.find((row) => row.status === "active");
    expect(active).toBeDefined();
    if (active === undefined) throw new Error("expected an active caregiver to revoke");

    await revokeMember({ deps, actorUserId: ownerId, workspaceId, targetUserId: active.userId });
    const caregiversAfter = await listChildCaregivers({
      deps,
      actorUserId: ownerId,
      workspaceId,
      childId,
    });
    expect(caregiversAfter.find((row) => row.userId === active.userId)?.status).toBe("revoked");
    expect(clerk.callsTo("removeOrganizationMember").some((call) => call.input !== undefined)).toBe(
      true,
    );

    const error = await expectApiError(() =>
      revokeMember({ deps, actorUserId: ownerId, workspaceId, targetUserId: ownerId }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe("conflict");
  });
});
