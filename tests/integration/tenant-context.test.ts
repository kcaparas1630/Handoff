import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../packages/db/src/client";
import { runMigrations } from "../../packages/db/src/migrate";
import * as childrenRepository from "../../packages/db/src/repositories/children";
import * as identityRepository from "../../packages/db/src/repositories/identity";
import { workspaces } from "../../packages/db/src/schema";
import {
  withIdentityTransaction,
  withTenantTransaction,
} from "../../packages/db/src/tenant-transaction";
import type { DbClient } from "../../packages/db/src/client";
import type { TestDatabase } from "./support/test-database";
import {
  createTestDatabase,
  missingDatabaseUrlMessage,
  syntheticEnvelope,
} from "./support/test-database";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping tenant context tests. ${missingDatabaseUrlMessage}`);

/** Drizzle wraps driver errors, so assertions read the whole cause chain. */
async function failureMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    return messages.join(" | ");
  }
  throw new Error("expected the operation to fail");
}

interface Tenant {
  workspaceId: string;
  childId: string;
  userId: string;
}

describeIntegration("tenant context", () => {
  let database: TestDatabase;
  let admin: DbClient;
  let tenantA: Tenant;
  let tenantB: Tenant;

  async function seedTenant(clerkSuffix: string): Promise<Tenant> {
    const workspaceId = randomUUID();
    const childId = randomUUID();
    const user = await withIdentityTransaction(admin.db, {}, (tx) =>
      identityRepository.upsertUserByClerkId(tx, {
        clerkUserId: `user_${clerkSuffix}`,
        profileCiphertext: syntheticEnvelope(`user-${clerkSuffix}`),
      }),
    );
    await withTenantTransaction(admin.db, { workspaceId }, async (tx) => {
      await identityRepository.insertWorkspace(tx, {
        id: workspaceId,
        clerkOrgId: `org_${clerkSuffix}`,
        kind: "daycare",
        profileCiphertext: syntheticEnvelope(`workspace-${clerkSuffix}`),
        timezone: "America/Vancouver",
        storageBudgetBytes: 1_000_000,
      });
      await identityRepository.upsertMembership(tx, {
        workspaceId,
        userId: user.id,
        clerkMembershipId: `orgmem_${clerkSuffix}`,
        appRole: "owner",
        status: "active",
        providerVerifiedAt: new Date(),
      });
      await childrenRepository.insertChild(tx, {
        id: childId,
        workspaceId,
        profileCiphertext: syntheticEnvelope(`child-${clerkSuffix}`),
        createdByUserId: user.id,
      });
    });
    return { workspaceId, childId, userId: user.id };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    admin = createDbClient({ url: database.adminUrl, maxConnections: 2 });
    tenantA = await seedTenant("tenant_a");
    tenantB = await seedTenant("tenant_b");
  }, 60_000);

  afterAll(async () => {
    await admin?.close();
    await database?.drop();
  });

  it("applies migrations from empty and treats a re-run as a no-op", async () => {
    const session = postgres(database.adminUrl, { max: 1, prepare: false });
    try {
      const before = await session`select count(*)::int as count from drizzle.__drizzle_migrations`;
      await runMigrations(database.adminUrl);
      const after = await session`select count(*)::int as count from drizzle.__drizzle_migrations`;
      expect(before[0]?.count).toBe(7);
      expect(after[0]?.count).toBe(before[0]?.count);
    } finally {
      await session.end();
    }
  });

  it("denies reads and writes to the restricted role without tenant context", async () => {
    const session = postgres(database.adminUrl, { max: 1, prepare: false });
    try {
      await session.unsafe("set role handoff_api");

      const visible = await session`select count(*)::int as count from handoff.children`;
      expect(visible[0]?.count).toBe(0);

      await expect(
        session`
          insert into handoff.children (id, workspace_id, profile_ciphertext, created_by_user_id)
          values (${randomUUID()}, ${tenantA.workspaceId}, ${session.json(syntheticEnvelope("smuggled"))}, ${tenantA.userId})
        `,
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await session.end();
    }
  });

  it("shows only the workspace named by the transaction-local setting", async () => {
    const session = postgres(database.adminUrl, { max: 1, prepare: false });
    try {
      await session.unsafe("set role handoff_api");
      const rows = await session.begin(async (tx) => {
        await tx`select set_config('handoff.workspace_id', ${tenantA.workspaceId}, true)`;
        return tx`select id, workspace_id from handoff.children`;
      });
      expect(rows.map((row) => row.id)).toEqual([tenantA.childId]);
      expect(rows.map((row) => row.workspace_id)).not.toContain(tenantB.workspaceId);
    } finally {
      await session.end();
    }
  });

  it("keeps 20 alternating pooled transactions from leaking across tenants", async () => {
    const api = createDbClient({ url: database.apiUrl, maxConnections: 4 });
    try {
      const requests = Array.from({ length: 20 }, (_, index) =>
        index % 2 === 0 ? tenantA : tenantB,
      );
      const results = await Promise.all(
        requests.map((tenant) =>
          withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, async (tx) => {
            const rows = await childrenRepository.listChildrenForWorkspace(tx, tenant.workspaceId);
            const everything = await childrenRepository.listChildrenForWorkspace(
              tx,
              tenantA.workspaceId === tenant.workspaceId
                ? tenantB.workspaceId
                : tenantA.workspaceId,
            );
            return { expected: tenant.childId, seen: rows.map((row) => row.id), everything };
          }),
        ),
      );
      for (const result of results) {
        expect(result.seen).toEqual([result.expected]);
        // Even asking for the other tenant by id returns nothing under the policy.
        expect(result.everything).toEqual([]);
      }
    } finally {
      await api.close();
    }
  });

  it("shows a bootstrap caller only their own memberships and workspaces", async () => {
    const api = createDbClient({ url: database.apiUrl, maxConnections: 2 });
    try {
      const seen = await withIdentityTransaction(
        api.db,
        { userId: tenantA.userId },
        async (tx) => ({
          own: await identityRepository.listActiveMembershipsForUser(tx, tenantA.userId),
          other: await identityRepository.listActiveMembershipsForUser(tx, tenantB.userId),
          visibleWorkspaces: await tx.select({ id: workspaces.id }).from(workspaces),
        }),
      );
      expect(seen.own.map((row) => row.workspace.id)).toEqual([tenantA.workspaceId]);
      expect(seen.other).toEqual([]);
      expect(seen.visibleWorkspaces.map((row) => row.id)).toEqual([tenantA.workspaceId]);
    } finally {
      await api.close();
    }
  });

  it("shows a verified organization admin only the workspace for that organization", async () => {
    const api = createDbClient({ url: database.apiUrl, maxConnections: 2 });
    try {
      const seen = await withIdentityTransaction(
        api.db,
        { clerkOrgId: "org_tenant_b" },
        async (tx) => ({
          verified: await identityRepository.findWorkspaceByClerkOrgId(tx, "org_tenant_b"),
          other: await identityRepository.findWorkspaceByClerkOrgId(tx, "org_tenant_a"),
        }),
      );
      expect(seen.verified?.id).toBe(tenantB.workspaceId);
      expect(seen.other).toBeNull();
    } finally {
      await api.close();
    }
  });

  it("shows nothing at all without a tenant or identity context", async () => {
    const api = createDbClient({ url: database.apiUrl, maxConnections: 2 });
    try {
      const seen = await withIdentityTransaction(api.db, {}, async (tx) => ({
        memberships: await identityRepository.listActiveMembershipsForUser(tx, tenantA.userId),
        visibleWorkspaces: await tx.select({ id: workspaces.id }).from(workspaces),
      }));
      expect(seen.memberships).toEqual([]);
      expect(seen.visibleWorkspaces).toEqual([]);
    } finally {
      await api.close();
    }
  });

  it("rejects a child grant that points at another workspace's child", async () => {
    const message = await failureMessage(() =>
      withTenantTransaction(admin.db, { workspaceId: tenantA.workspaceId }, (tx) =>
        childrenRepository.upsertChildCaregiver(tx, {
          workspaceId: tenantA.workspaceId,
          childId: tenantB.childId,
          userId: tenantA.userId,
          relationship: "caregiver",
          permission: "contributor",
          grantedByUserId: tenantA.userId,
        }),
      ),
    );
    expect(message).toMatch(/child_caregivers_child_fk/);
  });
});
