// Builds the runtime the milestone 2 services expect: a migrated database, the restricted API
// role, real encryption with a development wrapping key, and the in-memory Clerk gateway. Rows
// are created through the services themselves, so every profile is genuinely encrypted rather
// than a synthetic envelope the journal services could not decrypt.
import { randomBytes, randomUUID } from "node:crypto";
import { createDbClient } from "../../../packages/db/src/client";
import { createDataKeyStore } from "../../../packages/db/src/repositories/data-keys";
import { createDataKeyService } from "../../../packages/server/src/security/encryption/data-keys";
import { createDevelopmentKeyWrapper } from "../../../packages/server/src/security/encryption/development-key-wrapper";
import { bootstrap } from "../../../packages/server/src/services/bootstrap";
import { updateChildCaregivers } from "../../../packages/server/src/services/child-caregivers";
import { createChild } from "../../../packages/server/src/services/children";
import { initializeWorkspace } from "../../../packages/server/src/services/workspaces";
import { createFakeClerkGateway } from "./fake-clerk-gateway";
import { createTestDatabase } from "./test-database";
import type { ChildCaregiverGrant, WorkspaceKind } from "../../../packages/contracts/src/index";
import type { DbClient } from "../../../packages/db/src/client";
import type { ServiceDeps } from "../../../packages/server/src/types/runtime";
import type { FakeClerkGateway } from "./fake-clerk-gateway";
import type { TestDatabase } from "./test-database";

export const GUARDIAN_ROLE_KEY = "org:guardian";

export type TestAppRole = "owner" | "member" | "guardian";

export interface TestHarness {
  database: TestDatabase;
  api: DbClient;
  admin: DbClient;
  clerk: FakeClerkGateway;
  deps: ServiceDeps;
  /** Moves the service clock; null restores the real one. */
  setNow: (instant: Date | null) => void;
  close: () => Promise<void>;
}

const clerkRoles: Record<TestAppRole, string> = {
  owner: "org:admin",
  member: "org:member",
  guardian: GUARDIAN_ROLE_KEY,
};

export async function createHarness(): Promise<TestHarness> {
  const database = await createTestDatabase();
  const api = createDbClient({ url: database.apiUrl, maxConnections: 20 });
  // Mirrors the runtime: data keys resolve on their own pool, because they are read while a
  // tenant transaction already holds a connection.
  const keyClient = createDbClient({ url: database.apiUrl, maxConnections: 4 });
  const admin = createDbClient({ url: database.adminUrl, maxConnections: 2 });
  const clerk = createFakeClerkGateway();
  const keyWrapper = createDevelopmentKeyWrapper(randomBytes(32).toString("base64"));
  let fixedNow: Date | null = null;

  return {
    database,
    api,
    admin,
    clerk,
    deps: {
      db: api.db,
      keys: createDataKeyService({ store: createDataKeyStore(keyClient.db), wrapper: keyWrapper }),
      keyWrapper,
      clerk,
      guardianRoleKey: GUARDIAN_ROLE_KEY,
      invitationRedirectUrl: "https://handoff.test/accept-invitation",
      requestId: randomUUID(),
      now: () => fixedNow ?? new Date(),
    },
    setNow: (instant) => {
      fixedNow = instant;
    },
    close: async () => {
      await api.close();
      await keyClient.close();
      await admin.close();
      await database.drop();
    },
  };
}

export interface SeededWorkspace {
  workspaceId: string;
  clerkOrgId: string;
  ownerId: string;
}

export async function seedWorkspace(
  harness: TestHarness,
  input: { label: string; kind?: WorkspaceKind; timezone?: string },
): Promise<SeededWorkspace> {
  const clerkOrgId = `org_${input.label}`;
  const ownerId = await seedUser(harness, {
    label: `${input.label}_owner`,
    clerkOrgId,
    role: "owner",
    displayName: `Owner ${input.label}`,
  });
  const workspace = await initializeWorkspace({
    deps: harness.deps,
    userId: ownerId,
    clerkUserId: `user_${input.label}_owner`,
    input: {
      clerkOrgId,
      kind: input.kind ?? "daycare",
      name: `Workspace ${input.label}`,
      timezone: input.timezone ?? "America/Vancouver",
    },
  });
  return { workspaceId: workspace.id, clerkOrgId, ownerId };
}

/** Signs a synthetic caregiver in, with the organization membership Clerk would report. */
export async function seedUser(
  harness: TestHarness,
  input: { label: string; clerkOrgId: string; role: TestAppRole; displayName?: string },
): Promise<string> {
  const clerkUserId = `user_${input.label}`;
  harness.clerk.setUser(clerkUserId, `${input.label}@example.test`);
  harness.clerk.setMembership({
    clerkOrgId: input.clerkOrgId,
    clerkUserId,
    clerkMembershipId: `orgmem_${input.label}`,
    role: clerkRoles[input.role],
  });
  const response = await bootstrap({
    deps: harness.deps,
    clerkUserId,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
  });
  return response.user.id;
}

export async function seedChild(
  harness: TestHarness,
  input: { workspaceId: string; ownerId: string; name: string; birthdate?: string },
): Promise<string> {
  const child = await createChild({
    deps: harness.deps,
    actorUserId: input.ownerId,
    workspaceId: input.workspaceId,
    input: {
      name: input.name,
      ...(input.birthdate === undefined ? {} : { birthdate: input.birthdate }),
    },
  });
  return child.id;
}

export function grantChild(
  harness: TestHarness,
  input: {
    workspaceId: string;
    ownerId: string;
    childId: string;
    grants: ChildCaregiverGrant[];
  },
): Promise<unknown> {
  return updateChildCaregivers({
    deps: harness.deps,
    actorUserId: input.ownerId,
    workspaceId: input.workspaceId,
    childId: input.childId,
    input: { grants: input.grants },
  });
}
