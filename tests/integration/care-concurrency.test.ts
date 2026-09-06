import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../packages/db/src/client";
import * as careRepository from "../../packages/db/src/repositories/care";
import * as childrenRepository from "../../packages/db/src/repositories/children";
import * as handoffsRepository from "../../packages/db/src/repositories/handoffs";
import * as identityRepository from "../../packages/db/src/repositories/identity";
import { handoffBriefs } from "../../packages/db/src/schema";
import {
  withIdentityTransaction,
  withTenantTransaction,
} from "../../packages/db/src/tenant-transaction";
import type { DbClient } from "../../packages/db/src/client";
import type { HandoffTransaction } from "../../packages/db/src/types/database";
import type { SeededTenant, TestDatabase } from "./support/test-database";
import {
  createTestDatabase,
  failureMessage,
  missingDatabaseUrlMessage,
  seedChild,
  seedMember,
  seedTenant,
  syntheticEnvelope,
} from "./support/test-database";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping care concurrency tests. ${missingDatabaseUrlMessage}`);

describeIntegration("concurrent care and handoff cursors", () => {
  let database: TestDatabase;
  let admin: DbClient;
  /** Restricted role, so the sessions, cursors, and briefs below also pass the tenant policies. */
  let api: DbClient;
  let tenant: SeededTenant;
  let caregiverB: string;
  let secondChildId: string;

  function tenantTx<T>(run: (tx: HandoffTransaction) => Promise<T>): Promise<T> {
    return withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, run);
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    admin = createDbClient({ url: database.adminUrl, maxConnections: 2 });
    api = createDbClient({ url: database.apiUrl, maxConnections: 8 });
    tenant = await seedTenant(admin.db, "care_owner");
    caregiverB = await seedMember(admin.db, tenant.workspaceId, "care_b");
    secondChildId = await seedChild(
      admin.db,
      tenant.workspaceId,
      tenant.userId,
      "care_second_child",
    );
  }, 60_000);

  afterAll(async () => {
    await api?.close();
    await admin?.close();
    await database?.drop();
  });

  it("keeps 100 concurrent starts for one caregiver down to a single open session", async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        tenantTx((tx) =>
          careRepository.startCareSession(tx, {
            id: randomUUID(),
            workspaceId: tenant.workspaceId,
            childId: tenant.childId,
            userId: tenant.userId,
          }),
        ),
      ),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.session.id)).size).toBe(1);

    const open = await tenantTx((tx) =>
      careRepository.listActiveSessionsForChild(tx, tenant.workspaceId, tenant.childId),
    );
    expect(open).toHaveLength(1);
    expect(open[0]?.userId).toBe(tenant.userId);
  });

  it("lets a second caregiver care at the same time and end only their own session", async () => {
    const started = await tenantTx((tx) =>
      careRepository.startCareSession(tx, {
        id: randomUUID(),
        workspaceId: tenant.workspaceId,
        childId: tenant.childId,
        userId: caregiverB,
      }),
    );
    expect(started.created).toBe(true);

    const both = await tenantTx((tx) =>
      careRepository.listActiveSessionsForChild(tx, tenant.workspaceId, tenant.childId),
    );
    expect(both).toHaveLength(2);

    const ended = await tenantTx((tx) =>
      careRepository.endCareSession(tx, {
        workspaceId: tenant.workspaceId,
        childId: tenant.childId,
        userId: tenant.userId,
        endReason: "user_ended",
      }),
    );
    expect(ended?.endReason).toBe("user_ended");

    const remaining = await tenantTx((tx) =>
      careRepository.listActiveSessionsForChild(tx, tenant.workspaceId, tenant.childId),
    );
    expect(remaining.map((session) => session.userId)).toEqual([caregiverB]);

    // The partial unique index only covers open sessions, so caring again is a new session.
    const restarted = await tenantTx((tx) =>
      careRepository.startCareSession(tx, {
        id: randomUUID(),
        workspaceId: tenant.workspaceId,
        childId: tenant.childId,
        userId: tenant.userId,
      }),
    );
    expect(restarted.created).toBe(true);
    expect(restarted.session.id).not.toBe(ended?.id);
  });

  it("closes only the revoked member's sessions across the workspace", async () => {
    await tenantTx((tx) =>
      careRepository.startCareSession(tx, {
        id: randomUUID(),
        workspaceId: tenant.workspaceId,
        childId: secondChildId,
        userId: caregiverB,
      }),
    );

    const closed = await tenantTx((tx) =>
      careRepository.endAllSessionsForUserInWorkspace(tx, {
        workspaceId: tenant.workspaceId,
        userId: caregiverB,
        endReason: "membership_revoked",
      }),
    );
    expect(closed).toHaveLength(2);
    expect(closed.every((session) => session.endReason === "membership_revoked")).toBe(true);

    const survivors = await tenantTx((tx) =>
      careRepository.listActiveSessionsForChild(tx, tenant.workspaceId, tenant.childId),
    );
    expect(survivors.map((session) => session.userId)).toEqual([tenant.userId]);
  });

  it("never moves an acknowledgement cursor backward", async () => {
    const childId = await seedChild(admin.db, tenant.workspaceId, tenant.userId, "care_cursor");
    const laterBrief = await insertBrief(childId, 0, 10);
    const olderBrief = await insertBrief(childId, 0, 5);

    await tenantTx((tx) =>
      handoffsRepository.lockCursorForUpdate(tx, tenant.workspaceId, childId, tenant.userId),
    );
    const advanced = await tenantTx((tx) =>
      handoffsRepository.advanceCursor(tx, {
        workspaceId: tenant.workspaceId,
        childId,
        userId: tenant.userId,
        acknowledgedSeq: 10,
        briefId: laterBrief,
      }),
    );
    expect(advanced.acknowledgedSeq).toBe(10);

    const rewound = await tenantTx((tx) =>
      handoffsRepository.advanceCursor(tx, {
        workspaceId: tenant.workspaceId,
        childId,
        userId: tenant.userId,
        acknowledgedSeq: 5,
        briefId: olderBrief,
      }),
    );
    // The counter stays put and keeps pointing at the brief whose cutoff it sits at; the older
    // brief's own acknowledged_at is where that out-of-order read is recorded.
    expect(rewound.acknowledgedSeq).toBe(10);
    expect(rewound.lastAcknowledgedBriefId).toBe(laterBrief);
  });

  it("settles two concurrent acknowledgements on the higher cutoff", async () => {
    const childId = await seedChild(
      admin.db,
      tenant.workspaceId,
      tenant.userId,
      "care_cursor_race",
    );
    const lowerBrief = await insertBrief(childId, 0, 10);
    const higherBrief = await insertBrief(childId, 0, 12);

    const acknowledge = (acknowledgedSeq: number, briefId: string) =>
      tenantTx(async (tx) => {
        await handoffsRepository.lockCursorForUpdate(
          tx,
          tenant.workspaceId,
          childId,
          tenant.userId,
        );
        return handoffsRepository.advanceCursor(tx, {
          workspaceId: tenant.workspaceId,
          childId,
          userId: tenant.userId,
          acknowledgedSeq,
          briefId,
        });
      });

    await Promise.all([acknowledge(10, lowerBrief), acknowledge(12, higherBrief)]);

    const cursor = await tenantTx((tx) =>
      handoffsRepository.findCursor(tx, tenant.workspaceId, childId, tenant.userId),
    );
    expect(cursor?.acknowledgedSeq).toBe(12);
  });

  it("rejects a brief whose window runs backward", async () => {
    const message = await failureMessage(() =>
      tenantTx((tx) =>
        tx.insert(handoffBriefs).values({
          id: randomUUID(),
          workspaceId: tenant.workspaceId,
          childId: tenant.childId,
          recipientUserId: tenant.userId,
          fromSeqExclusive: 12,
          throughSeqInclusive: 4,
          snapshotCiphertext: syntheticEnvelope("snapshot"),
          rendererVersion: "brief-v1",
        }),
      ),
    );
    expect(message).toMatch(/handoff_briefs_seq_window/);
  });

  it("resolves a child's workspace only for an active member of that workspace", async () => {
    const other = await seedTenant(admin.db, "care_other_workspace");
    const revokedUserId = await seedMember(admin.db, tenant.workspaceId, "care_revoked");

    const asMember = await withIdentityTransaction(
      api.db,
      { userId: tenant.userId },
      async (tx) => ({
        own: await childrenRepository.findChildWorkspaceForMember(
          tx,
          tenant.userId,
          tenant.childId,
        ),
        foreign: await childrenRepository.findChildWorkspaceForMember(
          tx,
          tenant.userId,
          other.childId,
        ),
      }),
    );
    expect(asMember.own?.workspaceId).toBe(tenant.workspaceId);
    expect(asMember.foreign).toBeNull();

    const beforeRevocation = await withIdentityTransaction(
      api.db,
      { userId: revokedUserId },
      (tx) => childrenRepository.findChildWorkspaceForMember(tx, revokedUserId, tenant.childId),
    );
    expect(beforeRevocation?.workspaceId).toBe(tenant.workspaceId);

    await withTenantTransaction(admin.db, { workspaceId: tenant.workspaceId }, (tx) =>
      identityRepository.revokeMembership(tx, {
        workspaceId: tenant.workspaceId,
        userId: revokedUserId,
        expectedVersion: 1,
      }),
    );

    const afterRevocation = await withIdentityTransaction(api.db, { userId: revokedUserId }, (tx) =>
      childrenRepository.findChildWorkspaceForMember(tx, revokedUserId, tenant.childId),
    );
    expect(afterRevocation).toBeNull();
  });

  async function insertBrief(
    childId: string,
    fromSeqExclusive: number,
    throughSeqInclusive: number,
  ): Promise<string> {
    const brief = await tenantTx((tx) =>
      handoffsRepository.insertBrief(tx, {
        id: randomUUID(),
        workspaceId: tenant.workspaceId,
        childId,
        recipientUserId: tenant.userId,
        fromSeqExclusive,
        throughSeqInclusive,
        snapshotCiphertext: syntheticEnvelope("snapshot"),
        rendererVersion: "brief-v1",
      }),
    );
    return brief.id;
  }
});
