import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { careSessions } from "../../packages/db/src/schema";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { ApiHttpError } from "../../packages/server/src/http/errors";
import { endCare, listCare, startCare } from "../../packages/server/src/services/care";
import { revokeMember } from "../../packages/server/src/services/memberships";
import {
  createHarness,
  grantChild,
  seedChild,
  seedUser,
  seedWorkspace,
} from "./support/service-harness";
import { missingDatabaseUrlMessage } from "./support/test-database";
import type { TestHarness } from "./support/service-harness";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping care service tests. ${missingDatabaseUrlMessage}`);

async function expectApiError(run: () => Promise<unknown>): Promise<ApiHttpError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiHttpError) return error;
    throw error;
  }
  throw new Error("expected the operation to fail");
}

describeIntegration("care sessions", () => {
  let harness: TestHarness;
  let workspaceId: string;
  let ownerId: string;
  let caregiverA: string;
  let caregiverB: string;
  let readerId: string;
  let childId: string;

  function sessionRowsFor(userId: string) {
    return withTenantTransaction(harness.api.db, { workspaceId }, (tx) =>
      tx
        .select()
        .from(careSessions)
        .where(and(eq(careSessions.workspaceId, workspaceId), eq(careSessions.userId, userId))),
    );
  }

  beforeAll(async () => {
    harness = await createHarness();
    const workspace = await seedWorkspace(harness, { label: "care" });
    workspaceId = workspace.workspaceId;
    ownerId = workspace.ownerId;
    caregiverA = await seedUser(harness, {
      label: "care_a",
      clerkOrgId: workspace.clerkOrgId,
      role: "member",
      displayName: "Alex A",
    });
    caregiverB = await seedUser(harness, {
      label: "care_b",
      clerkOrgId: workspace.clerkOrgId,
      role: "member",
      displayName: "Bailey B",
    });
    readerId = await seedUser(harness, {
      label: "care_reader",
      clerkOrgId: workspace.clerkOrgId,
      role: "guardian",
      displayName: "Robin Reader",
    });
    childId = await seedChild(harness, { workspaceId, ownerId, name: "Ada" });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId,
      grants: [
        { userId: caregiverA, relationship: "caregiver", permission: "contributor" },
        { userId: caregiverB, relationship: "caregiver", permission: "contributor" },
        { userId: readerId, relationship: "parent", permission: "reader" },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("keeps 100 concurrent starts for one caregiver down to a single session", async () => {
    const sessions = await Promise.all(
      Array.from({ length: 100 }, () =>
        startCare({ deps: harness.deps, actorUserId: caregiverA, childId }),
      ),
    );
    const ids = new Set(sessions.map((session) => session.id));
    expect(ids.size).toBe(1);
    expect(sessions[0]?.displayName).toBe("Alex A");

    const open = await listCare({ deps: harness.deps, actorUserId: caregiverA, childId });
    expect(open).toHaveLength(1);
  }, 120_000);

  it("lets a second caregiver care at the same time and ends only their own session", async () => {
    const sessionB = await startCare({ deps: harness.deps, actorUserId: caregiverB, childId });
    const both = await listCare({ deps: harness.deps, actorUserId: ownerId, childId });
    expect(both.map((session) => session.displayName).sort()).toEqual(["Alex A", "Bailey B"]);

    const endedA = await endCare({ deps: harness.deps, actorUserId: caregiverA, childId });
    expect(endedA.endReason).toBe("user_ended");

    const remaining = await listCare({ deps: harness.deps, actorUserId: ownerId, childId });
    expect(remaining.map((session) => session.id)).toEqual([sessionB.id]);

    const nothingToEnd = await expectApiError(() =>
      endCare({ deps: harness.deps, actorUserId: caregiverA, childId }),
    );
    expect(nothingToEnd.status).toBe(404);
  });

  it("lets a reader declare their own care without gaining journal permissions", async () => {
    const session = await startCare({ deps: harness.deps, actorUserId: readerId, childId });
    expect(session.userId).toBe(readerId);
    await endCare({ deps: harness.deps, actorUserId: readerId, childId });
  });

  it("closes a revoked member's sessions with the revocation reason", async () => {
    await startCare({ deps: harness.deps, actorUserId: caregiverA, childId });
    const before = await listCare({ deps: harness.deps, actorUserId: ownerId, childId });
    expect(before.some((session) => session.userId === caregiverA)).toBe(true);

    await revokeMember({
      deps: harness.deps,
      actorUserId: ownerId,
      workspaceId,
      targetUserId: caregiverA,
    });

    const rows = await sessionRowsFor(caregiverA);
    expect(rows.every((row) => row.endedAt !== null)).toBe(true);
    expect(rows.some((row) => row.endReason === "membership_revoked")).toBe(true);

    // Nobody else's session is touched by that revocation.
    const remaining = await listCare({ deps: harness.deps, actorUserId: ownerId, childId });
    expect(remaining.map((session) => session.userId)).toEqual([caregiverB]);
  });
});
