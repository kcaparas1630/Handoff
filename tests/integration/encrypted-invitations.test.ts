import { randomBytes, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../packages/db/src/client";
import { createDataKeyStore } from "../../packages/db/src/repositories/data-keys";
import * as invitationsRepository from "../../packages/db/src/repositories/invitations";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { workspaceScope } from "../../packages/server/src/lib/record-contexts";
import { createDataKeyService } from "../../packages/server/src/security/encryption/data-keys";
import { createDevelopmentKeyWrapper } from "../../packages/server/src/security/encryption/development-key-wrapper";
import { computeInvitationLookupHash } from "../../packages/server/src/security/encryption/lib/invitation-lookup";
import { bootstrap } from "../../packages/server/src/services/bootstrap";
import { createChild } from "../../packages/server/src/services/children";
import { listChildCaregivers } from "../../packages/server/src/services/child-caregivers";
import { createInvitation } from "../../packages/server/src/services/invitations";
import { applyAcceptedInvitation } from "../../packages/server/src/services/invitation-acceptance";
import { initializeWorkspace } from "../../packages/server/src/services/workspaces";
import type { DbClient } from "../../packages/db/src/client";
import type { ServiceDeps } from "../../packages/server/src/types/runtime";
import type { FakeClerkGateway } from "./support/fake-clerk-gateway";
import { createFakeClerkGateway } from "./support/fake-clerk-gateway";
import type { TestDatabase } from "./support/test-database";
import { createTestDatabase, missingDatabaseUrlMessage } from "./support/test-database";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping encrypted invitation tests. ${missingDatabaseUrlMessage}`);

const INVITEE_EMAIL = "marker-invite-9f3a@example.test";

describeIntegration("encrypted invitation lookup", () => {
  let database: TestDatabase;
  let api: DbClient;
  let clerk: FakeClerkGateway;
  let deps: ServiceDeps;
  let firstWorkspaceId: string;
  let secondWorkspaceId: string;
  let firstChildId: string;
  let ownerId: string;

  async function seedWorkspace(suffix: string): Promise<{ workspaceId: string; childId: string }> {
    clerk.setMembership({
      clerkOrgId: `org_${suffix}`,
      clerkUserId: "user_owner",
      clerkMembershipId: `orgmem_${suffix}`,
      role: "org:admin",
    });
    const workspace = await initializeWorkspace({
      deps,
      userId: ownerId,
      clerkUserId: "user_owner",
      input: {
        clerkOrgId: `org_${suffix}`,
        kind: "daycare",
        name: `Workspace ${suffix}`,
        timezone: "UTC",
      },
    });
    const child = await createChild({
      deps,
      actorUserId: ownerId,
      workspaceId: workspace.id,
      input: { name: `Child ${suffix}` },
    });
    return { workspaceId: workspace.id, childId: child.id };
  }

  async function storedLookupHash(workspaceId: string, invitationId: string): Promise<Buffer> {
    const intent = await withTenantTransaction(api.db, { workspaceId }, (tx) =>
      invitationsRepository.findInvitationById(tx, workspaceId, invitationId),
    );
    if (intent === null) throw new Error("expected the invitation intent to exist");
    return Buffer.from(intent.emailLookupHash);
  }

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
      guardianRoleKey: "org:guardian",
      invitationRedirectUrl: "https://handoff.test/accept-invitation",
      requestId: randomUUID(),
      now: () => new Date(),
    };

    clerk.setUser("user_owner", "owner@example.test");
    const owner = await bootstrap({ deps, clerkUserId: "user_owner", displayName: "Owner" });
    ownerId = owner.user.id;
    const first = await seedWorkspace("first");
    firstWorkspaceId = first.workspaceId;
    firstChildId = first.childId;
    secondWorkspaceId = (await seedWorkspace("second")).workspaceId;
  }, 90_000);

  afterAll(async () => {
    await api?.close();
    await database?.drop();
  });

  it("produces a different lookup value for the same address in another workspace", async () => {
    const first = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId: firstWorkspaceId,
      input: {
        email: INVITEE_EMAIL,
        intendedAppRole: "guardian",
        childGrants: [{ childId: firstChildId, relationship: "parent", permission: "reader" }],
      },
    });
    const secondChildId = (
      await createChild({
        deps,
        actorUserId: ownerId,
        workspaceId: secondWorkspaceId,
        input: { name: "Second child" },
      })
    ).id;
    const second = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId: secondWorkspaceId,
      input: {
        email: INVITEE_EMAIL,
        intendedAppRole: "guardian",
        childGrants: [{ childId: secondChildId, relationship: "parent", permission: "reader" }],
      },
    });

    expect(second.id).not.toBe(first.id);
    const firstHash = await storedLookupHash(firstWorkspaceId, first.id);
    const secondHash = await storedLookupHash(secondWorkspaceId, second.id);
    expect(firstHash.equals(secondHash)).toBe(false);

    // The other workspace's value must not find this workspace's open intent either.
    const crossTenant = await withTenantTransaction(
      api.db,
      { workspaceId: firstWorkspaceId },
      (tx) =>
        invitationsRepository.findPendingInvitationByLookupHash(tx, firstWorkspaceId, secondHash),
    );
    expect(crossTenant).toBeNull();
  });

  it("normalizes case and surrounding whitespace to one lookup value", async () => {
    const lookupKey = await deps.keys.getLookupKey(workspaceScope(firstWorkspaceId));
    const canonical = computeInvitationLookupHash({
      lookupKey: lookupKey.key,
      workspaceId: firstWorkspaceId,
      email: INVITEE_EMAIL,
    });
    const messy = computeInvitationLookupHash({
      lookupKey: lookupKey.key,
      workspaceId: firstWorkspaceId,
      email: "  MARKER-Invite-9F3A@Example.Test  ",
    });
    expect(messy.equals(canonical)).toBe(true);

    const found = await withTenantTransaction(api.db, { workspaceId: firstWorkspaceId }, (tx) =>
      invitationsRepository.findPendingInvitationByLookupHash(tx, firstWorkspaceId, messy),
    );
    expect(found).not.toBeNull();
  });

  it("treats a matching lookup value as a candidate, not as authorization", async () => {
    const lookupKey = await deps.keys.getLookupKey(workspaceScope(firstWorkspaceId));
    const candidateHash = computeInvitationLookupHash({
      lookupKey: lookupKey.key,
      workspaceId: firstWorkspaceId,
      email: INVITEE_EMAIL,
    });
    const intent = await withTenantTransaction(api.db, { workspaceId: firstWorkspaceId }, (tx) =>
      invitationsRepository.findPendingInvitationByLookupHash(tx, firstWorkspaceId, candidateHash),
    );
    expect(intent).not.toBeNull();
    if (intent === null) throw new Error("expected a candidate intent");

    clerk.setUser("user_wrong", "someone-else@example.test");
    clerk.setMembership({
      clerkOrgId: "org_first",
      clerkUserId: "user_wrong",
      clerkMembershipId: "orgmem_wrong",
      role: "org:member",
    });
    const wrongUser = await bootstrap({ deps, clerkUserId: "user_wrong" });

    const result = await withTenantTransaction(api.db, { workspaceId: firstWorkspaceId }, (tx) =>
      applyAcceptedInvitation({
        tx,
        deps,
        workspaceId: firstWorkspaceId,
        intentId: intent.id,
        acceptedUserId: wrongUser.user.id,
        acceptedPrimaryEmail: "someone-else@example.test",
        membership: {
          clerkOrgId: "org_first",
          clerkUserId: "user_wrong",
          clerkMembershipId: "orgmem_wrong",
          role: "org:member",
        },
      }),
    );
    expect(result).toEqual({ applied: false, reason: "wrong_recipient" });

    const caregivers = await listChildCaregivers({
      deps,
      actorUserId: ownerId,
      workspaceId: firstWorkspaceId,
      childId: firstChildId,
    });
    expect(caregivers.some((row) => row.userId === wrongUser.user.id)).toBe(false);
  });
});
