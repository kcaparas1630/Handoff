import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as handoffsRepository from "../../packages/db/src/repositories/handoffs";
import { eventRevisions } from "../../packages/db/src/schema";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { ApiHttpError } from "../../packages/server/src/http/errors";
import { createCapture } from "../../packages/server/src/services/captures";
import { correctEvent, deleteEvent } from "../../packages/server/src/services/events";
import { acknowledgeBrief } from "../../packages/server/src/services/handoff-acknowledgement";
import { createBrief, getBrief } from "../../packages/server/src/services/handoffs";
import { listCare } from "../../packages/server/src/services/care";
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
  console.warn(`Skipping handoff boundary tests. ${missingDatabaseUrlMessage}`);

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

describeIntegration("handoff boundaries", () => {
  let harness: TestHarness;
  let workspaceId: string;
  let ownerId: string;
  let authorId: string;
  let recipientId: string;
  let otherRecipientId: string;

  /** Each scenario gets its own child so one test's journal cannot move another's cutoff. */
  async function freshChild(name: string): Promise<string> {
    const childId = await seedChild(harness, { workspaceId, ownerId, name });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId,
      grants: [
        { userId: authorId, relationship: "caregiver", permission: "contributor" },
        { userId: recipientId, relationship: "caregiver", permission: "contributor" },
        { userId: otherRecipientId, relationship: "caregiver", permission: "contributor" },
      ],
    });
    return childId;
  }

  function readCursor(childId: string, userId: string) {
    return withTenantTransaction(harness.api.db, { workspaceId }, (tx) =>
      handoffsRepository.findCursor(tx, workspaceId, childId, userId),
    );
  }

  /** Pushes one revision out of the disclosed 24 hour first-handoff window. */
  async function backdateRevisions(eventId: string, hours: number): Promise<void> {
    await withTenantTransaction(harness.admin.db, { workspaceId }, (tx) =>
      tx.execute(
        `update handoff.event_revisions set created_at = now() - interval '${String(hours)} hours' where event_id = '${eventId}'`,
      ),
    );
  }

  beforeAll(async () => {
    harness = await createHarness();
    const workspace = await seedWorkspace(harness, { label: "handoff", timezone: "UTC" });
    workspaceId = workspace.workspaceId;
    ownerId = workspace.ownerId;
    authorId = await seedUser(harness, {
      label: "handoff_author",
      clerkOrgId: workspace.clerkOrgId,
      role: "member",
      displayName: "Ana Author",
    });
    recipientId = await seedUser(harness, {
      label: "handoff_recipient",
      clerkOrgId: workspace.clerkOrgId,
      role: "member",
      displayName: "Rae Recipient",
    });
    otherRecipientId = await seedUser(harness, {
      label: "handoff_other",
      clerkOrgId: workspace.clerkOrgId,
      role: "member",
      displayName: "Ollie Other",
    });
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("puts a late upload whose care happened before the cutoff into the next brief", async () => {
    const childId = await freshChild("Late Upload");
    const now = Date.now();
    await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [candidate({ kind: "feed", occurredAt: new Date(now - HOUR_MS).toISOString() })],
    });
    const first = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    await acknowledgeBrief({
      deps: harness.deps,
      actorUserId: recipientId,
      briefId: first.id,
      input: { startCare: false },
    });

    // Recorded at 02:00 but only confirmed now: its occurrence precedes the cutoff, its sequence
    // does not, so filtering on occurrence alone would lose it.
    const late = await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [
        candidate({ kind: "feed", occurredAt: new Date(now - 8 * HOUR_MS).toISOString() }),
      ],
    });
    const lateEventId = late.events[0]?.id;
    expect(first.snapshot.updates.some((entry) => entry.eventId === lateEventId)).toBe(false);

    const second = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    expect(second.snapshot.boundary.fromSeqExclusive).toBe(
      first.snapshot.boundary.throughSeqInclusive,
    );
    const entry = second.snapshot.updates.find((item) => item.eventId === lateEventId);
    expect(entry?.label).toBe("new");
  });

  it("shows a correction of an older event as an update in the following brief", async () => {
    const childId = await freshChild("Correction");
    const confirmed = await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [
        candidate({
          kind: "feed",
          occurredAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
          amountValue: "60.00",
          amountUnit: "ml",
        }),
      ],
    });
    const created = confirmed.events[0];
    if (created === undefined) throw new Error("expected one confirmed event");

    const first = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    await acknowledgeBrief({
      deps: harness.deps,
      actorUserId: recipientId,
      briefId: first.id,
      input: { startCare: false },
    });
    await correctEvent({
      deps: harness.deps,
      actorUserId: authorId,
      eventId: created.id,
      input: { expectedVersion: created.version, amountValue: "90.00", amountUnit: "ml" },
    });

    const second = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    const entry = second.snapshot.updates.find((item) => item.eventId === created.id);
    expect(entry?.label).toBe("updated");
    expect(entry?.text).toContain("90 ml");
  });

  it("shows a deletion as removed and leaves the earlier brief unchanged", async () => {
    const childId = await freshChild("Deletion");
    const confirmed = await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [
        candidate({ kind: "diaper", occurredAt: new Date(Date.now() - HOUR_MS).toISOString() }),
      ],
    });
    const created = confirmed.events[0];
    if (created === undefined) throw new Error("expected one confirmed event");

    const first = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    const firstSnapshot = JSON.stringify(first.snapshot);
    await acknowledgeBrief({
      deps: harness.deps,
      actorUserId: recipientId,
      briefId: first.id,
      input: { startCare: false },
    });
    await deleteEvent({
      deps: harness.deps,
      actorUserId: authorId,
      eventId: created.id,
      input: { expectedVersion: created.version },
    });

    const second = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    expect(second.snapshot.updates.find((item) => item.eventId === created.id)?.label).toBe(
      "removed",
    );

    // The stored snapshot is stable: later edits produce new revisions and a new brief.
    const reloaded = await getBrief({
      deps: harness.deps,
      actorUserId: recipientId,
      briefId: first.id,
    });
    expect(JSON.stringify(reloaded.snapshot)).toBe(firstSnapshot);
    expect(reloaded.isStale).toBe(true);
    expect(reloaded.newerChangeCount).toBeGreaterThan(0);
  });

  it("counts a pending draft without ever rendering it as a fact", async () => {
    const childId = await freshChild("Pending Draft");
    await createCapture({
      deps: harness.deps,
      actorUserId: authorId,
      input: {
        childId,
        clientCaptureId: randomUUID(),
        inputKind: "manual",
        capturedAt: new Date().toISOString(),
        timezone: "UTC",
        locale: "en-CA",
        candidates: [candidate({ kind: "feed", occurredAt: new Date().toISOString() })],
      },
    });

    const brief = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    expect(brief.snapshot.pendingCaptureCount).toBe(1);
    expect(brief.snapshot.updates).toHaveLength(0);
    expect(brief.snapshot.essentials).toHaveLength(0);
    expect(brief.snapshot.sourceRevisionIds).toHaveLength(0);
  });

  it("accepts an empty first brief at sequence zero", async () => {
    const childId = await freshChild("Empty");
    const brief = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    expect(brief.snapshot.boundary).toMatchObject({
      fromSeqExclusive: 0,
      throughSeqInclusive: 0,
    });
    expect(brief.snapshot.updates).toHaveLength(0);
    expect(brief.isStale).toBe(false);

    const acknowledged = await acknowledgeBrief({
      deps: harness.deps,
      actorUserId: recipientId,
      briefId: brief.id,
      input: { startCare: false },
    });
    expect(acknowledged.acknowledgedSeq).toBe(0);
  });

  it("discloses the 24 hour window on a first visit and leaves older history out of it", async () => {
    const childId = await freshChild("First Visit");
    const old = await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [
        candidate({
          kind: "feed",
          occurredAt: new Date(Date.now() - 72 * HOUR_MS).toISOString(),
          amountValue: "50.00",
          amountUnit: "ml",
        }),
      ],
    });
    const oldEvent = old.events[0];
    if (oldEvent === undefined) throw new Error("expected one confirmed event");
    await backdateRevisions(oldEvent.id, 72);

    const recent = await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [
        candidate({ kind: "diaper", occurredAt: new Date(Date.now() - HOUR_MS).toISOString() }),
      ],
    });

    const brief = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    expect(brief.snapshot.boundary.initialWindowStart).not.toBeNull();
    expect(brief.snapshot.boundary.label).toContain("First handoff");
    expect(brief.snapshot.updates.map((entry) => entry.eventId)).toEqual([recent.events[0]?.id]);
    // The older feed is still available as labeled latest-known context.
    expect(brief.snapshot.essentials.map((fact) => fact.eventId)).toContain(oldEvent.id);
  });

  it("cites a source revision inside the window for every rendered entry", async () => {
    const childId = await freshChild("Traceable");
    await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [
        candidate({ kind: "feed", occurredAt: new Date(Date.now() - HOUR_MS).toISOString() }),
        candidate({ kind: "milestone", occurredAt: new Date(Date.now() - HOUR_MS).toISOString() }),
      ],
    });
    const brief = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    const rendered = [...brief.snapshot.updates, ...brief.snapshot.moments];
    expect(rendered.length).toBe(2);

    const ids = rendered.map((entry) => entry.revisionId);
    const rows = await withTenantTransaction(harness.api.db, { workspaceId }, (tx) =>
      tx
        .select()
        .from(eventRevisions)
        .where(and(eq(eventRevisions.childId, childId), inArray(eventRevisions.id, ids))),
    );
    expect(rows).toHaveLength(ids.length);
    for (const row of rows) {
      expect(row.journalSeq).toBeGreaterThan(brief.snapshot.boundary.fromSeqExclusive);
      expect(row.journalSeq).toBeLessThanOrEqual(brief.snapshot.boundary.throughSeqInclusive);
      expect(brief.snapshot.sourceRevisionIds).toContain(row.id);
    }
  });

  it("leaves the cursor at the newer cutoff when an older brief is acknowledged late", async () => {
    const childId = await freshChild("Stale Acknowledgement");
    await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [candidate({ kind: "feed", occurredAt: new Date().toISOString() })],
    });
    const first = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [candidate({ kind: "diaper", occurredAt: new Date().toISOString() })],
    });
    const second = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    expect(second.snapshot.boundary.throughSeqInclusive).toBeGreaterThan(
      first.snapshot.boundary.throughSeqInclusive,
    );

    await acknowledgeBrief({
      deps: harness.deps,
      actorUserId: recipientId,
      briefId: second.id,
      input: { startCare: false },
    });
    const late = await acknowledgeBrief({
      deps: harness.deps,
      actorUserId: recipientId,
      briefId: first.id,
      input: { startCare: false },
    });
    expect(late.acknowledgedSeq).toBe(second.snapshot.boundary.throughSeqInclusive);

    const cursor = await readCursor(childId, recipientId);
    expect(cursor?.acknowledgedSeq).toBe(second.snapshot.boundary.throughSeqInclusive);
    expect(cursor?.lastAcknowledgedBriefId).toBe(second.id);
  });

  it("settles two devices acknowledging out of order on the higher cutoff", async () => {
    const childId = await freshChild("Two Devices");
    await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [candidate({ kind: "feed", occurredAt: new Date().toISOString() })],
    });
    const first = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [candidate({ kind: "note", occurredAt: new Date().toISOString() })],
    });
    const second = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });

    await Promise.all([
      acknowledgeBrief({
        deps: harness.deps,
        actorUserId: recipientId,
        briefId: second.id,
        input: { startCare: false },
      }),
      acknowledgeBrief({
        deps: harness.deps,
        actorUserId: recipientId,
        briefId: first.id,
        input: { startCare: false },
      }),
    ]);

    const cursor = await readCursor(childId, recipientId);
    expect(cursor?.acknowledgedSeq).toBe(second.snapshot.boundary.throughSeqInclusive);
  });

  it("hides one recipient's brief from another caregiver", async () => {
    const childId = await freshChild("Recipient Scoped");
    const brief = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });

    const read = await expectApiError(() =>
      getBrief({ deps: harness.deps, actorUserId: otherRecipientId, briefId: brief.id }),
    );
    expect(read.status).toBe(404);

    const acknowledge = await expectApiError(() =>
      acknowledgeBrief({
        deps: harness.deps,
        actorUserId: otherRecipientId,
        briefId: brief.id,
        input: { startCare: false },
      }),
    );
    expect(acknowledge.status).toBe(404);
  });

  it("opens exactly one care session when an acknowledgement with start care is repeated", async () => {
    const childId = await freshChild("Start Care");
    await confirmManualCapture(harness, {
      actorUserId: authorId,
      childId,
      candidates: [candidate({ kind: "feed", occurredAt: new Date().toISOString() })],
    });
    const brief = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });

    const first = await acknowledgeBrief({
      deps: harness.deps,
      actorUserId: recipientId,
      briefId: brief.id,
      input: { startCare: true },
    });
    const replay = await acknowledgeBrief({
      deps: harness.deps,
      actorUserId: recipientId,
      briefId: brief.id,
      input: { startCare: true },
    });
    expect(first.session).not.toBeNull();
    expect(replay.session?.id).toBe(first.session?.id);
    expect(replay.brief.acknowledgedAt).toBe(first.brief.acknowledgedAt);

    const sessions = await listCare({ deps: harness.deps, actorUserId: recipientId, childId });
    expect(sessions.filter((session) => session.userId === recipientId)).toHaveLength(1);
  });
});
