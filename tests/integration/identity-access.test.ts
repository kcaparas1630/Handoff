import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../packages/db/src/client";
import * as childrenRepository from "../../packages/db/src/repositories/children";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { createDataKeyStore } from "../../packages/db/src/repositories/data-keys";
import { ApiHttpError } from "../../packages/server/src/http/errors";
import { createDataKeyService } from "../../packages/server/src/security/encryption/data-keys";
import { createDevelopmentKeyWrapper } from "../../packages/server/src/security/encryption/development-key-wrapper";
import { bootstrap } from "../../packages/server/src/services/bootstrap";
import {
  listChildCaregivers,
  updateChildCaregivers,
} from "../../packages/server/src/services/child-caregivers";
import {
  createChild,
  getChild,
  listChildren,
  updateChild,
} from "../../packages/server/src/services/children";
import { listMembers, revokeMember } from "../../packages/server/src/services/memberships";
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
  console.warn(`Skipping identity access tests. ${missingDatabaseUrlMessage}`);

const GUARDIAN_ROLE_KEY = "org:guardian";

async function expectApiError(run: () => Promise<unknown>): Promise<ApiHttpError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiHttpError) return error;
    throw error;
  }
  throw new Error("expected the operation to fail");
}

describeIntegration("identity and access", () => {
  let database: TestDatabase;
  let api: DbClient;
  let admin: DbClient;
  let clerk: FakeClerkGateway;
  let deps: ServiceDeps;

  const daycareOrgId = "org_daycare_one";
  const householdOrgId = "org_household_two";
  let daycareWorkspaceId: string;
  let householdWorkspaceId: string;
  let ownerId: string;
  let staffId: string;
  let guardianId: string;
  let householdOwnerId: string;
  let childOneId: string;
  let childTwoId: string;
  let householdChildId: string;

  async function signIn(clerkUserId: string, email: string, displayName: string) {
    clerk.setUser(clerkUserId, email);
    const response = await bootstrap({ deps, clerkUserId, displayName });
    return response;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    api = createDbClient({ url: database.apiUrl, maxConnections: 10 });
    admin = createDbClient({ url: database.adminUrl, maxConnections: 2 });
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

    const owner = await signIn("user_owner", "owner@example.test", "Owner One");
    ownerId = owner.user.id;
    clerk.setMembership({
      clerkOrgId: daycareOrgId,
      clerkUserId: "user_owner",
      clerkMembershipId: "orgmem_owner",
      role: "org:admin",
    });
    const daycare = await initializeWorkspace({
      deps,
      userId: ownerId,
      clerkUserId: "user_owner",
      input: {
        clerkOrgId: daycareOrgId,
        kind: "daycare",
        name: "Sunny Days",
        timezone: "America/Vancouver",
      },
    });
    daycareWorkspaceId = daycare.id;

    const householdOwner = await signIn("user_home", "home@example.test", "Owner Two");
    householdOwnerId = householdOwner.user.id;
    clerk.setMembership({
      clerkOrgId: householdOrgId,
      clerkUserId: "user_home",
      clerkMembershipId: "orgmem_home",
      role: "org:admin",
    });
    const household = await initializeWorkspace({
      deps,
      userId: householdOwnerId,
      clerkUserId: "user_home",
      input: {
        clerkOrgId: householdOrgId,
        kind: "household",
        name: "The Rivera Home",
        timezone: "UTC",
      },
    });
    householdWorkspaceId = household.id;

    const childOne = await createChild({
      deps,
      actorUserId: ownerId,
      workspaceId: daycareWorkspaceId,
      input: { name: "Ada", birthdate: "2025-02-01" },
    });
    childOneId = childOne.id;
    const childTwo = await createChild({
      deps,
      actorUserId: ownerId,
      workspaceId: daycareWorkspaceId,
      input: { name: "Bo" },
    });
    childTwoId = childTwo.id;
    const householdChild = await createChild({
      deps,
      actorUserId: householdOwnerId,
      workspaceId: householdWorkspaceId,
      input: { name: "Cleo" },
    });
    householdChildId = householdChild.id;

    clerk.setMembership({
      clerkOrgId: daycareOrgId,
      clerkUserId: "user_staff",
      clerkMembershipId: "orgmem_staff",
      role: "org:member",
    });
    const staff = await signIn("user_staff", "staff@example.test", "Sam Staff");
    staffId = staff.user.id;

    clerk.setMembership({
      clerkOrgId: daycareOrgId,
      clerkUserId: "user_guardian",
      clerkMembershipId: "orgmem_guardian",
      role: GUARDIAN_ROLE_KEY,
    });
    const guardian = await signIn("user_guardian", "guardian@example.test", "Gina Guardian");
    guardianId = guardian.user.id;

    await updateChildCaregivers({
      deps,
      actorUserId: ownerId,
      workspaceId: daycareWorkspaceId,
      childId: childOneId,
      input: {
        grants: [
          { userId: staffId, relationship: "caregiver", permission: "contributor" },
          { userId: guardianId, relationship: "parent", permission: "reader" },
        ],
      },
    });
  }, 90_000);

  afterAll(async () => {
    await api?.close();
    await admin?.close();
    await database?.drop();
  });

  it("creates the local user and reconciles verified organization memberships", () => {
    expect(staffId).not.toBe(ownerId);
    const staffWorkspaces = clerk.callsTo("listUserOrganizationMemberships");
    expect(staffWorkspaces.length).toBeGreaterThan(0);
  });

  it("returns the caller's workspaces with decrypted names on a repeated bootstrap", async () => {
    const response = await bootstrap({ deps, clerkUserId: "user_staff" });
    expect(response.user.id).toBe(staffId);
    expect(response.user.displayName).toBe("Sam Staff");
    expect(response.workspaces).toHaveLength(1);
    expect(response.workspaces[0]?.name).toBe("Sunny Days");
    expect(response.workspaces[0]?.appRole).toBe("caregiver");
  });

  it("lets an owner read every child in their workspace", async () => {
    const children = await listChildren({
      deps,
      actorUserId: ownerId,
      workspaceId: daycareWorkspaceId,
    });
    expect(children.map((child) => child.name).sort()).toEqual(["Ada", "Bo"]);
    const ada = await getChild({
      deps,
      actorUserId: ownerId,
      workspaceId: daycareWorkspaceId,
      childId: childOneId,
    });
    expect(ada.permission).toBe("manager");
    expect(ada.birthdate).toBe("2025-02-01");
  });

  it("limits staff to their granted child and returns 404 for the rest", async () => {
    const children = await listChildren({
      deps,
      actorUserId: staffId,
      workspaceId: daycareWorkspaceId,
    });
    expect(children.map((child) => child.id)).toEqual([childOneId]);
    expect(children[0]?.permission).toBe("contributor");

    const error = await expectApiError(() =>
      getChild({
        deps,
        actorUserId: staffId,
        workspaceId: daycareWorkspaceId,
        childId: childTwoId,
      }),
    );
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });

  it("keeps a guardian read-only even with an erroneous contributor grant", async () => {
    // Written straight to the table: the API refuses to store this grant in the first place.
    await withTenantTransaction(admin.db, { workspaceId: daycareWorkspaceId }, (tx) =>
      childrenRepository.upsertChildCaregiver(tx, {
        workspaceId: daycareWorkspaceId,
        childId: childOneId,
        userId: guardianId,
        relationship: "parent",
        permission: "contributor",
        grantedByUserId: ownerId,
      }),
    );

    const child = await getChild({
      deps,
      actorUserId: guardianId,
      workspaceId: daycareWorkspaceId,
      childId: childOneId,
    });
    expect(child.permission).toBe("reader");

    const error = await expectApiError(() =>
      updateChild({
        deps,
        actorUserId: guardianId,
        workspaceId: daycareWorkspaceId,
        childId: childOneId,
        input: { expectedVersion: child.version, name: "Renamed" },
      }),
    );
    expect(error.status).toBe(403);
    expect(error.code).toBe("forbidden");
  });

  it("rejects an elevated grant to a guardian with a validation error", async () => {
    const error = await expectApiError(() =>
      updateChildCaregivers({
        deps,
        actorUserId: ownerId,
        workspaceId: daycareWorkspaceId,
        childId: childTwoId,
        input: {
          grants: [{ userId: guardianId, relationship: "parent", permission: "manager" }],
        },
      }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe("validation_failed");
  });

  it("hides another workspace's child from a member of this one", async () => {
    const error = await expectApiError(() =>
      getChild({
        deps,
        actorUserId: staffId,
        workspaceId: householdWorkspaceId,
        childId: householdChildId,
      }),
    );
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });

  it("rejects a birthdate in the future", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const error = await expectApiError(() =>
      createChild({
        deps,
        actorUserId: ownerId,
        workspaceId: daycareWorkspaceId,
        input: { name: "Future", birthdate: tomorrow },
      }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe("validation_failed");
    expect(error.fieldErrors?.birthdate).toBeDefined();
  });

  it("returns 409 when an update carries a stale expected version", async () => {
    const before = await getChild({
      deps,
      actorUserId: ownerId,
      workspaceId: daycareWorkspaceId,
      childId: childTwoId,
    });
    const updated = await updateChild({
      deps,
      actorUserId: ownerId,
      workspaceId: daycareWorkspaceId,
      childId: childTwoId,
      input: { expectedVersion: before.version, name: "Bo Renamed" },
    });
    expect(updated.name).toBe("Bo Renamed");
    expect(updated.version).toBe(before.version + 1);

    const error = await expectApiError(() =>
      updateChild({
        deps,
        actorUserId: ownerId,
        workspaceId: daycareWorkspaceId,
        childId: childTwoId,
        input: { expectedVersion: before.version, name: "Conflicting" },
      }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe("conflict");
  });

  it("returns the same workspace when initialization is retried for the same organization", async () => {
    const retried = await initializeWorkspace({
      deps,
      userId: ownerId,
      clerkUserId: "user_owner",
      input: {
        clerkOrgId: daycareOrgId,
        kind: "daycare",
        name: "Sunny Days",
        timezone: "America/Vancouver",
      },
    });
    expect(retried.id).toBe(daycareWorkspaceId);
  });

  it("refuses workspace initialization for a non-administrator of the organization", async () => {
    const error = await expectApiError(() =>
      initializeWorkspace({
        deps,
        userId: staffId,
        clerkUserId: "user_staff",
        input: {
          clerkOrgId: daycareOrgId,
          kind: "daycare",
          name: "Not Mine",
          timezone: "UTC",
        },
      }),
    );
    expect(error.status).toBe(403);
    expect(error.code).toBe("forbidden");
  });

  it("rejects an unknown time zone before any row is written", async () => {
    clerk.setMembership({
      clerkOrgId: "org_bad_zone",
      clerkUserId: "user_owner",
      clerkMembershipId: "orgmem_bad_zone",
      role: "org:admin",
    });
    const error = await expectApiError(() =>
      initializeWorkspace({
        deps,
        userId: ownerId,
        clerkUserId: "user_owner",
        input: {
          clerkOrgId: "org_bad_zone",
          kind: "household",
          name: "Nowhere",
          timezone: "Mars/Olympus",
        },
      }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe("validation_failed");
  });

  it("shows the roster to a manager and hides it from a guardian", async () => {
    const caregivers = await listChildCaregivers({
      deps,
      actorUserId: ownerId,
      workspaceId: daycareWorkspaceId,
      childId: childOneId,
    });
    expect(caregivers.map((row) => row.displayName).sort()).toEqual(["Gina Guardian", "Sam Staff"]);

    const error = await expectApiError(() =>
      listChildCaregivers({
        deps,
        actorUserId: guardianId,
        workspaceId: daycareWorkspaceId,
        childId: childOneId,
      }),
    );
    expect(error.status).toBe(403);

    const members = await listMembers({
      deps,
      actorUserId: ownerId,
      workspaceId: daycareWorkspaceId,
    });
    expect(members.map((member) => member.appRole).sort()).toEqual([
      "caregiver",
      "guardian",
      "owner",
    ]);
  });

  it("returns 404 to a revoked member and closes their child grants", async () => {
    await revokeMember({
      deps,
      actorUserId: ownerId,
      workspaceId: daycareWorkspaceId,
      targetUserId: staffId,
    });

    const error = await expectApiError(() =>
      getChild({
        deps,
        actorUserId: staffId,
        workspaceId: daycareWorkspaceId,
        childId: childOneId,
      }),
    );
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");

    const grants = await listChildCaregivers({
      deps,
      actorUserId: ownerId,
      workspaceId: daycareWorkspaceId,
      childId: childOneId,
    });
    expect(grants.find((row) => row.userId === staffId)?.status).toBe("revoked");
  });

  it("refuses to remove the last owner", async () => {
    const error = await expectApiError(() =>
      revokeMember({
        deps,
        actorUserId: ownerId,
        workspaceId: daycareWorkspaceId,
        targetUserId: ownerId,
      }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe("conflict");
  });
});
