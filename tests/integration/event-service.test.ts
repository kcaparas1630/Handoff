import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as childrenRepository from "../../packages/db/src/repositories/children";
import * as eventsRepository from "../../packages/db/src/repositories/events";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { ApiHttpError } from "../../packages/server/src/http/errors";
import { runIdempotent } from "../../packages/server/src/http/idempotency";
import { workspaceScope } from "../../packages/server/src/lib/record-contexts";
import { confirmCapture } from "../../packages/server/src/services/capture-confirmation";
import { createCapture, getCapture } from "../../packages/server/src/services/captures";
import {
  correctEvent,
  deleteEvent,
  getEvent,
  listEvents,
} from "../../packages/server/src/services/events";
import { listEventsForCapture } from "../../packages/db/src/repositories/events";
import { candidate, confirmManualCapture } from "./support/journal-fixtures";
import {
  createHarness,
  grantChild,
  seedChild,
  seedUser,
  seedWorkspace,
} from "./support/service-harness";
import { missingDatabaseUrlMessage } from "./support/test-database";
import type { DraftCandidate } from "../../packages/contracts/src/index";
import type { TestHarness } from "./support/service-harness";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping event service tests. ${missingDatabaseUrlMessage}`);

async function expectApiError(run: () => Promise<unknown>): Promise<ApiHttpError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiHttpError) return error;
    throw error;
  }
  throw new Error("expected the operation to fail");
}

describeIntegration("event service", () => {
  let harness: TestHarness;
  let workspaceId: string;
  let ownerId: string;
  let contributorId: string;
  let secondContributorId: string;
  let readerId: string;
  let childId: string;

  async function journalSeq(): Promise<number> {
    const child = await withTenantTransaction(harness.api.db, { workspaceId }, (tx) =>
      childrenRepository.findChildInWorkspace(tx, workspaceId, childId),
    );
    return child?.journalSeq ?? -1;
  }

  function revisionsOf(eventId: string) {
    return withTenantTransaction(harness.api.db, { workspaceId }, (tx) =>
      eventsRepository.listRevisionsForEvent(tx, workspaceId, childId, eventId),
    );
  }

  beforeAll(async () => {
    harness = await createHarness();
    const workspace = await seedWorkspace(harness, { label: "events" });
    workspaceId = workspace.workspaceId;
    ownerId = workspace.ownerId;
    const clerkOrgId = workspace.clerkOrgId;
    contributorId = await seedUser(harness, {
      label: "events_contributor",
      clerkOrgId,
      role: "member",
      displayName: "Casey Contributor",
    });
    secondContributorId = await seedUser(harness, {
      label: "events_second",
      clerkOrgId,
      role: "member",
      displayName: "Sam Second",
    });
    readerId = await seedUser(harness, {
      label: "events_reader",
      clerkOrgId,
      role: "guardian",
      displayName: "Robin Reader",
    });
    childId = await seedChild(harness, { workspaceId, ownerId, name: "Ada" });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId,
      grants: [
        { userId: contributorId, relationship: "caregiver", permission: "contributor" },
        { userId: secondContributorId, relationship: "caregiver", permission: "contributor" },
        { userId: readerId, relationship: "parent", permission: "reader" },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("confirms every manual entry kind and decrypts each one back exactly", async () => {
    const startedAt = new Date("2026-09-05T17:00:00.000Z");
    const candidates: DraftCandidate[] = [
      candidate({
        kind: "feed",
        occurredAt: "2026-09-05T16:00:00.000Z",
        amountValue: "60.00",
        amountUnit: "ml",
        details: { kind: "feed", method: "bottle", description: "took it slowly" },
      }),
      candidate({
        kind: "feed",
        occurredAt: "2026-09-05T12:30:00.000Z",
        details: { kind: "feed", method: "breast" },
      }),
      candidate({
        kind: "diaper",
        occurredAt: "2026-09-05T11:00:00.000Z",
        details: { kind: "diaper", contents: "stool", quantity: "a lot" },
      }),
      candidate({
        kind: "sleep",
        occurredAt: startedAt.toISOString(),
        endedAt: "2026-09-05T18:30:00.000Z",
        details: { kind: "sleep", state: "interval", note: "in the cot" },
      }),
      candidate({
        kind: "milestone",
        occurredAt: "2026-09-05T15:00:00.000Z",
        important: true,
        details: {
          kind: "milestone",
          description: "First word",
          quote: "Dada",
          reportedFirst: true,
        },
      }),
      candidate({
        kind: "note",
        occurredAt: null,
        timePrecision: "unknown",
        details: { kind: "note", text: "Give 60 ml later", intent: "planned" },
      }),
    ];

    const confirmed = await confirmManualCapture(harness, {
      actorUserId: contributorId,
      childId,
      candidates,
    });
    expect(confirmed.capture.status).toBe("confirmed");
    expect(confirmed.events).toHaveLength(6);

    const page = await listEvents({
      deps: harness.deps,
      actorUserId: contributorId,
      childId,
      query: { limit: 20 },
    });
    const byKindAndTime = new Map(
      page.items.map((event) => [`${event.kind}:${event.occurredAt ?? "unknown"}`, event]),
    );

    const withAmount = byKindAndTime.get("feed:2026-09-05T16:00:00.000Z");
    expect(withAmount?.amountValue).toBe("60.00");
    expect(withAmount?.amountUnit).toBe("ml");
    expect(withAmount?.details).toEqual({
      kind: "feed",
      method: "bottle",
      description: "took it slowly",
    });

    // An unstated amount stays unstated: no invented zero and no typical bottle size.
    const withoutAmount = byKindAndTime.get("feed:2026-09-05T12:30:00.000Z");
    expect(withoutAmount?.amountValue).toBeNull();
    expect(withoutAmount?.amountUnit).toBeNull();

    const diaper = byKindAndTime.get("diaper:2026-09-05T11:00:00.000Z");
    expect(diaper?.details).toEqual({ kind: "diaper", contents: "stool", quantity: "a lot" });

    const sleep = byKindAndTime.get("sleep:2026-09-05T17:00:00.000Z");
    expect(sleep?.endedAt).toBe("2026-09-05T18:30:00.000Z");

    const milestone = byKindAndTime.get("milestone:2026-09-05T15:00:00.000Z");
    expect(milestone?.important).toBe(true);
    expect(milestone?.details).toEqual({
      kind: "milestone",
      description: "First word",
      quote: "Dada",
      reportedFirst: true,
    });

    // The plan is stored as a plan; nothing turns it into a completed feed.
    const plan = byKindAndTime.get("note:unknown");
    expect(plan?.timePrecision).toBe("unknown");
    expect(plan?.details).toEqual({
      kind: "note",
      text: "Give 60 ml later",
      intent: "planned",
    });
  });

  it("rejects an invalid reviewed candidate with 422 and leaves the capture unconfirmed", async () => {
    const cases: { name: string; stored: DraftCandidate; reviewed: Partial<DraftCandidate> }[] = [
      {
        name: "amount without unit",
        stored: candidate({ kind: "feed", occurredAt: "2026-09-05T16:00:00.000Z" }),
        reviewed: { amountValue: "60.00", amountUnit: null },
      },
      {
        name: "sleep interval ending before it starts",
        stored: candidate({
          kind: "sleep",
          occurredAt: "2026-09-05T17:00:00.000Z",
          endedAt: "2026-09-05T18:00:00.000Z",
          details: { kind: "sleep", state: "interval" },
        }),
        reviewed: { endedAt: "2026-09-05T16:00:00.000Z" },
      },
      {
        name: "unknown time with exact precision",
        stored: candidate({ kind: "diaper", occurredAt: "2026-09-05T16:00:00.000Z" }),
        reviewed: { occurredAt: null, timePrecision: "exact" },
      },
    ];

    for (const testCase of cases) {
      const capture = await createCapture({
        deps: harness.deps,
        actorUserId: contributorId,
        input: {
          childId,
          clientCaptureId: randomUUID(),
          inputKind: "manual",
          capturedAt: new Date().toISOString(),
          timezone: "America/Vancouver",
          locale: "en-CA",
          candidates: [testCase.stored],
        },
      });
      const { sourceStart: _s, sourceEnd: _e, ...reviewable } = testCase.stored;
      const error = await expectApiError(() =>
        confirmCapture({
          deps: harness.deps,
          actorUserId: contributorId,
          captureId: capture.id,
          input: {
            expectedDraftVersion: capture.draftVersion,
            candidates: [{ ...reviewable, ...testCase.reviewed }],
          },
        }),
      );
      expect(`${testCase.name}: ${String(error.status)}`).toBe(`${testCase.name}: 422`);
      expect(error.code).toBe("validation_failed");
      expect(Object.keys(error.fieldErrors ?? {}).length).toBeGreaterThan(0);

      const unchanged = await getCapture({
        deps: harness.deps,
        actorUserId: contributorId,
        captureId: capture.id,
      });
      expect(`${testCase.name}: ${unchanged.status}`).toBe(`${testCase.name}: needs_review`);
      const published = await withTenantTransaction(harness.api.db, { workspaceId }, (tx) =>
        listEventsForCapture(tx, workspaceId, capture.id),
      );
      expect(published).toHaveLength(0);
    }
  });

  it("creates one event per candidate under 100 concurrent confirmations", async () => {
    const candidates = [
      candidate({ kind: "feed", occurredAt: "2026-09-06T08:00:00.000Z" }),
      candidate({ kind: "diaper", occurredAt: "2026-09-06T08:05:00.000Z" }),
      candidate({ kind: "note", occurredAt: "2026-09-06T08:10:00.000Z" }),
    ];
    const capture = await createCapture({
      deps: harness.deps,
      actorUserId: contributorId,
      input: {
        childId,
        clientCaptureId: randomUUID(),
        inputKind: "manual",
        capturedAt: new Date().toISOString(),
        timezone: "America/Vancouver",
        locale: "en-CA",
        candidates,
      },
    });
    const request = {
      expectedDraftVersion: capture.draftVersion,
      candidates: candidates.map(({ sourceStart: _s, sourceEnd: _e, ...rest }) => rest),
    };

    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        confirmCapture({
          deps: harness.deps,
          actorUserId: contributorId,
          captureId: capture.id,
          input: request,
        }),
      ),
    );

    const stored = await withTenantTransaction(harness.api.db, { workspaceId }, (tx) =>
      listEventsForCapture(tx, workspaceId, capture.id),
    );
    expect(stored).toHaveLength(3);
    const expected = [...stored.map((row) => row.id)].sort();
    for (const response of responses) {
      expect([...response.events.map((event) => event.id)].sort()).toEqual(expected);
    }
  }, 120_000);

  it("appends a correction as a new revision and refuses a stale expected version", async () => {
    const confirmed = await confirmManualCapture(harness, {
      actorUserId: contributorId,
      childId,
      candidates: [
        candidate({
          kind: "feed",
          occurredAt: "2026-09-06T10:00:00.000Z",
          amountValue: "60.00",
          amountUnit: "ml",
          sourceQuote: "Fed 60 ml at two",
        }),
      ],
    });
    const created = confirmed.events[0];
    if (created === undefined) throw new Error("expected one confirmed event");
    const seqBefore = await journalSeq();

    const corrected = await correctEvent({
      deps: harness.deps,
      actorUserId: contributorId,
      eventId: created.id,
      input: { expectedVersion: created.version, amountValue: "90.00", amountUnit: "ml" },
    });
    expect(corrected.amountValue).toBe("90.00");
    expect(corrected.version).toBe(created.version + 1);
    // The correction keeps citing the words it came from.
    expect(corrected.sourceQuote).toBe("Fed 60 ml at two");
    expect(await journalSeq()).toBe(seqBefore + 1);

    const revisions = await revisionsOf(created.id);
    expect(revisions.map((revision) => revision.operation)).toEqual(["created", "corrected"]);
    expect(revisions[1]?.journalSeq).toBe((revisions[0]?.journalSeq ?? 0) + 1);

    const stale = await expectApiError(() =>
      correctEvent({
        deps: harness.deps,
        actorUserId: contributorId,
        eventId: created.id,
        input: { expectedVersion: created.version, amountValue: "120.00", amountUnit: "ml" },
      }),
    );
    expect(stale.status).toBe(409);
    expect(stale.code).toBe("conflict");
  });

  it("removes an entry with a deletion revision and drops it from the timeline", async () => {
    const confirmed = await confirmManualCapture(harness, {
      actorUserId: contributorId,
      childId,
      candidates: [candidate({ kind: "diaper", occurredAt: "2026-09-06T11:00:00.000Z" })],
    });
    const created = confirmed.events[0];
    if (created === undefined) throw new Error("expected one confirmed event");

    const deleted = await deleteEvent({
      deps: harness.deps,
      actorUserId: contributorId,
      eventId: created.id,
      input: { expectedVersion: created.version },
    });
    expect(deleted.status).toBe("deleted");

    const revisions = await revisionsOf(created.id);
    expect(revisions[revisions.length - 1]?.operation).toBe("deleted");

    const page = await listEvents({
      deps: harness.deps,
      actorUserId: contributorId,
      childId,
      query: { limit: 50 },
    });
    expect(page.items.some((event) => event.id === created.id)).toBe(false);

    // Replaying the deletion cannot delete it twice; the version has already moved.
    const replay = await expectApiError(() =>
      deleteEvent({
        deps: harness.deps,
        actorUserId: contributorId,
        eventId: created.id,
        input: { expectedVersion: created.version },
      }),
    );
    expect(replay.status).toBe(409);
  });

  it("refuses journal writes to a reader while still letting them read", async () => {
    const create = await expectApiError(() =>
      createCapture({
        deps: harness.deps,
        actorUserId: readerId,
        input: {
          childId,
          clientCaptureId: randomUUID(),
          inputKind: "manual",
          capturedAt: new Date().toISOString(),
          timezone: "America/Vancouver",
          locale: "en-CA",
          candidates: [candidate({})],
        },
      }),
    );
    expect(create.status).toBe(403);

    const confirmed = await confirmManualCapture(harness, {
      actorUserId: contributorId,
      childId,
      candidates: [candidate({ kind: "feed", occurredAt: "2026-09-06T12:00:00.000Z" })],
    });
    const created = confirmed.events[0];
    if (created === undefined) throw new Error("expected one confirmed event");

    // Another author's draft is not visible at all, so confirming it is a 404, not a 403.
    const confirm = await expectApiError(() =>
      confirmCapture({
        deps: harness.deps,
        actorUserId: readerId,
        captureId: confirmed.capture.id,
        input: { expectedDraftVersion: confirmed.capture.draftVersion, candidates: [] },
      }),
    );
    expect(confirm.status).toBe(404);

    const correct = await expectApiError(() =>
      correctEvent({
        deps: harness.deps,
        actorUserId: readerId,
        eventId: created.id,
        input: { expectedVersion: created.version, important: true },
      }),
    );
    expect(correct.status).toBe(403);

    const readable = await getEvent({
      deps: harness.deps,
      actorUserId: readerId,
      eventId: created.id,
    });
    expect(readable.id).toBe(created.id);
  });

  it("lets an owner correct another author's entry but not a second contributor", async () => {
    const confirmed = await confirmManualCapture(harness, {
      actorUserId: contributorId,
      childId,
      candidates: [candidate({ kind: "feed", occurredAt: "2026-09-06T13:00:00.000Z" })],
    });
    const created = confirmed.events[0];
    if (created === undefined) throw new Error("expected one confirmed event");

    const forbidden = await expectApiError(() =>
      correctEvent({
        deps: harness.deps,
        actorUserId: secondContributorId,
        eventId: created.id,
        input: { expectedVersion: created.version, important: true },
      }),
    );
    expect(forbidden.status).toBe(403);

    const corrected = await correctEvent({
      deps: harness.deps,
      actorUserId: ownerId,
      eventId: created.id,
      input: { expectedVersion: created.version, important: true },
    });
    expect(corrected.important).toBe(true);
    expect(corrected.lastEditedByUserId).toBe(ownerId);
  });

  it("runs one execution for 20 concurrent requests that share an idempotency key", async () => {
    const key = randomUUID();
    let executions = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        withTenantTransaction(harness.api.db, { workspaceId }, (tx) =>
          runIdempotent({
            tx,
            keys: harness.deps.keys,
            actor: { userId: contributorId },
            operation: "captures.confirm",
            key,
            scope: workspaceScope(workspaceId),
            requestBody: JSON.stringify({ captureId: "same" }),
            now: harness.deps.now,
            execute: () => {
              executions += 1;
              return Promise.resolve({ status: 201, body: { attempt: executions } });
            },
          }),
        ),
      ),
    );
    expect(executions).toBe(1);
    for (const result of results) {
      expect(result).toEqual({ status: 201, body: { attempt: 1 } });
    }
  }, 60_000);
});
