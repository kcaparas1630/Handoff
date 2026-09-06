import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiHttpError } from "../../packages/server/src/http/errors";
import { acknowledgeBrief } from "../../packages/server/src/services/handoff-acknowledgement";
import { createBrief } from "../../packages/server/src/services/handoffs";
import { getOverview } from "../../packages/server/src/services/overview";
import { candidate, confirmManualCapture } from "./support/journal-fixtures";
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
  console.warn(`Skipping overview tests. ${missingDatabaseUrlMessage}`);

const HOUR_MS = 60 * 60 * 1000;

async function expectApiError(run: () => Promise<unknown>): Promise<ApiHttpError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiHttpError) return error;
    throw error;
  }
  throw new Error("expected the operation to fail");
}

describeIntegration("overview projection", () => {
  let harness: TestHarness;
  let workspaceId: string;
  let ownerId: string;
  let caregiverId: string;
  let parentId: string;
  let otherParentId: string;
  let childId: string;
  let otherChildId: string;
  let oldFeedId: string;

  beforeAll(async () => {
    harness = await createHarness();
    const workspace = await seedWorkspace(harness, { label: "overview", timezone: "UTC" });
    workspaceId = workspace.workspaceId;
    ownerId = workspace.ownerId;
    caregiverId = await seedUser(harness, {
      label: "overview_caregiver",
      clerkOrgId: workspace.clerkOrgId,
      role: "member",
      displayName: "Cam Caregiver",
    });
    parentId = await seedUser(harness, {
      label: "overview_parent",
      clerkOrgId: workspace.clerkOrgId,
      role: "guardian",
      displayName: "Pat Parent",
    });
    otherParentId = await seedUser(harness, {
      label: "overview_other_parent",
      clerkOrgId: workspace.clerkOrgId,
      role: "guardian",
      displayName: "Ola Other",
    });

    childId = await seedChild(harness, { workspaceId, ownerId, name: "Ada" });
    otherChildId = await seedChild(harness, { workspaceId, ownerId, name: "Bo" });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId,
      grants: [
        { userId: caregiverId, relationship: "caregiver", permission: "contributor" },
        { userId: parentId, relationship: "parent", permission: "reader" },
      ],
    });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId: otherChildId,
      grants: [{ userId: otherParentId, relationship: "parent", permission: "reader" }],
    });

    // One feed, then thirty newer entries of other kinds: the latest feed is well past the first
    // page of the timeline.
    const now = Date.now();
    const feed = await confirmManualCapture(harness, {
      actorUserId: caregiverId,
      childId,
      candidates: [
        candidate({
          kind: "feed",
          occurredAt: new Date(now - 30 * HOUR_MS).toISOString(),
          amountValue: "60.00",
          amountUnit: "ml",
        }),
      ],
    });
    oldFeedId = feed.events[0]?.id ?? "";
    for (let index = 0; index < 30; index += 1) {
      await confirmManualCapture(harness, {
        actorUserId: caregiverId,
        childId,
        candidates: [
          candidate({
            kind: index % 2 === 0 ? "diaper" : "note",
            // 25 hours ago up to 10.5, so every one of them is newer than that feed.
            occurredAt: new Date(now - (25 - index * 0.5) * HOUR_MS).toISOString(),
          }),
        ],
      });
    }
  }, 180_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("finds the latest feed beyond the first page of the timeline", async () => {
    const overview = await getOverview({ deps: harness.deps, actorUserId: caregiverId, childId });
    expect(overview.latest.feed?.eventId).toBe(oldFeedId);
    expect(overview.latest.feed?.amountValue).toBe("60.00");
    expect(overview.latest.feed?.text).toContain("60 ml");
    expect(overview.recentActivity).toHaveLength(5);
    expect(overview.recentActivity.some((event) => event.id === oldFeedId)).toBe(false);
  });

  it("keeps a feed reported without a time out of the latest ranking", async () => {
    const reported = await confirmManualCapture(harness, {
      actorUserId: caregiverId,
      childId,
      candidates: [
        candidate({
          kind: "feed",
          occurredAt: null,
          timePrecision: "unknown",
          amountValue: "90.00",
          amountUnit: "ml",
        }),
      ],
    });
    const unknownFeedId = reported.events[0]?.id;

    const overview = await getOverview({ deps: harness.deps, actorUserId: caregiverId, childId });
    // It is shown, labeled as reported without a time, and it does not become "the latest feed".
    expect(overview.recentUnknownTime.map((fact) => fact.eventId)).toContain(unknownFeedId);
    expect(overview.recentUnknownTime[0]?.text).toContain("time not given");
    expect(overview.latest.feed?.eventId).toBe(oldFeedId);
  });

  it("never reports a planned note as completed care", async () => {
    const planned = await confirmManualCapture(harness, {
      actorUserId: caregiverId,
      childId,
      candidates: [
        candidate({
          kind: "note",
          occurredAt: new Date().toISOString(),
          details: { kind: "note", text: "Give 60 ml later", intent: "planned" },
        }),
      ],
    });
    const plannedId = planned.events[0]?.id;

    const overview = await getOverview({ deps: harness.deps, actorUserId: caregiverId, childId });
    const latestIds = [
      overview.latest.feed?.eventId,
      overview.latest.sleep?.eventId,
      overview.latest.diaper?.eventId,
    ];
    expect(latestIds).not.toContain(plannedId);
    expect(overview.recentUnknownTime.map((fact) => fact.eventId)).not.toContain(plannedId);
    // It is still visible as what it is: a plan on the timeline.
    expect(overview.recentActivity.some((event) => event.id === plannedId)).toBe(true);
  });

  it("counts unread changes per caller and never advances the cursor", async () => {
    const beforeCaregiver = await getOverview({
      deps: harness.deps,
      actorUserId: caregiverId,
      childId,
    });
    const beforeParent = await getOverview({ deps: harness.deps, actorUserId: parentId, childId });
    expect(beforeCaregiver.unreadChangeCount).toBe(beforeParent.unreadChangeCount);
    expect(beforeParent.unreadChangeCount).toBeGreaterThan(0);

    const brief = await createBrief({ deps: harness.deps, actorUserId: parentId, childId });
    // Generating and reading a brief is not an acknowledgement.
    const afterRead = await getOverview({ deps: harness.deps, actorUserId: parentId, childId });
    expect(afterRead.unreadChangeCount).toBe(beforeParent.unreadChangeCount);

    await acknowledgeBrief({
      deps: harness.deps,
      actorUserId: parentId,
      briefId: brief.id,
      input: { startCare: false },
    });

    const parentAfter = await getOverview({ deps: harness.deps, actorUserId: parentId, childId });
    const caregiverAfter = await getOverview({
      deps: harness.deps,
      actorUserId: caregiverId,
      childId,
    });
    expect(parentAfter.unreadChangeCount).toBe(0);
    // The other caller's count is their own and did not move.
    expect(caregiverAfter.unreadChangeCount).toBe(beforeCaregiver.unreadChangeCount);

    const reloaded = await getOverview({ deps: harness.deps, actorUserId: parentId, childId });
    expect(reloaded.unreadChangeCount).toBe(0);
  });

  it("returns 404 for a child the caller has no grant for", async () => {
    const error = await expectApiError(() =>
      getOverview({ deps: harness.deps, actorUserId: otherParentId, childId }),
    );
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");

    const own = await getOverview({
      deps: harness.deps,
      actorUserId: otherParentId,
      childId: otherChildId,
    });
    expect(own.child.name).toBe("Bo");
    expect(own.unreadChangeCount).toBe(0);
  });
});
