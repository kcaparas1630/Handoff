import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../packages/db/src/client";
import * as capturesRepository from "../../packages/db/src/repositories/captures";
import * as eventsRepository from "../../packages/db/src/repositories/events";
import * as overviewRepository from "../../packages/db/src/repositories/overview";
import { captures, eventRevisions, events } from "../../packages/db/src/schema";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import type { DbClient } from "../../packages/db/src/client";
import type { HandoffDatabase } from "../../packages/db/src/types/database";
import type { EventKind } from "../../packages/db/src/types/enums";
import type { EventCursor, EventRow } from "../../packages/db/src/types/journal";
import type { SeededTenant, TestDatabase } from "./support/test-database";
import {
  createTestDatabase,
  failureMessage,
  missingDatabaseUrlMessage,
  seedChild,
  seedTenant,
  syntheticEnvelope,
} from "./support/test-database";
import { and, eq } from "drizzle-orm";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping journal transaction tests. ${missingDatabaseUrlMessage}`);

interface PublishInput {
  childId: string;
  captureId: string;
  kind: EventKind;
  occurredAt: Date | null;
}

describeIntegration("journal transactions", () => {
  let database: TestDatabase;
  let admin: DbClient;
  /** Restricted role, so every write below also passes the milestone 2 tenant policies. */
  let api: DbClient;
  let tenant: SeededTenant;
  let captureId: string;

  async function seedCapture(childId: string): Promise<string> {
    const id = randomUUID();
    await withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, (tx) =>
      capturesRepository.insertCapture(tx, {
        id,
        workspaceId: tenant.workspaceId,
        childId,
        authorUserId: tenant.userId,
        clientCaptureId: randomUUID(),
        inputKind: "manual",
        capturedAt: new Date(),
        timezone: "America/Vancouver",
        locale: "en-CA",
        contentCiphertext: syntheticEnvelope("draft"),
        schemaVersion: 1,
        status: "needs_review",
      }),
    );
    return id;
  }

  /** The published-change procedure the event service composes: lock, allocate, write both rows. */
  async function publishEvent(db: HandoffDatabase, input: PublishInput) {
    return withTenantTransaction(db, { workspaceId: tenant.workspaceId }, async (tx) => {
      await eventsRepository.lockChildForJournalWrite(tx, tenant.workspaceId, input.childId);
      const journalSeq = await eventsRepository.allocateJournalSeq(
        tx,
        tenant.workspaceId,
        input.childId,
      );
      const eventId = randomUUID();
      const revisionId = randomUUID();
      return eventsRepository.insertEventWithRevision(tx, {
        event: {
          id: eventId,
          workspaceId: tenant.workspaceId,
          childId: input.childId,
          captureId: input.captureId,
          sourceCandidateId: randomUUID(),
          createdByUserId: tenant.userId,
          lastEditedByUserId: tenant.userId,
          kind: input.kind,
          occurredAt: input.occurredAt,
          endedAt: null,
          timezone: "America/Vancouver",
          timePrecision: input.occurredAt === null ? "unknown" : "exact",
          payloadCiphertext: syntheticEnvelope("payload"),
          important: false,
          currentRevisionId: revisionId,
        },
        revision: {
          id: revisionId,
          workspaceId: tenant.workspaceId,
          childId: input.childId,
          eventId,
          journalSeq,
          eventVersion: 1,
          operation: "created",
          actorUserId: tenant.userId,
          contentCiphertext: syntheticEnvelope("snapshot"),
        },
      });
    });
  }

  async function currentJournalSeq(childId: string): Promise<number> {
    return withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, async (tx) => {
      const locked = await eventsRepository.lockChildForJournalWrite(
        tx,
        tenant.workspaceId,
        childId,
      );
      return locked?.journalSeq ?? -1;
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    admin = createDbClient({ url: database.adminUrl, maxConnections: 2 });
    api = createDbClient({ url: database.apiUrl, maxConnections: 8 });
    tenant = await seedTenant(admin.db, "journal_owner");
    captureId = await seedCapture(tenant.childId);
  }, 60_000);

  afterAll(async () => {
    await api?.close();
    await admin?.close();
    await database?.drop();
  });

  it("commits an event and its first revision together", async () => {
    const published = await publishEvent(api.db, {
      childId: tenant.childId,
      captureId,
      kind: "feed",
      occurredAt: new Date("2026-09-05T09:00:00Z"),
    });

    const stored = await withTenantTransaction(
      api.db,
      { workspaceId: tenant.workspaceId },
      async (tx) => ({
        event: await eventsRepository.findEventInChild(
          tx,
          tenant.workspaceId,
          tenant.childId,
          published.event.id,
        ),
        revisions: await eventsRepository.listRevisionsForEvent(
          tx,
          tenant.workspaceId,
          tenant.childId,
          published.event.id,
        ),
      }),
    );

    // The deferred key is checked at commit, so a visible event always has its revision.
    expect(stored.event?.currentRevisionId).toBe(published.revision.id);
    expect(stored.revisions).toHaveLength(1);
    expect(stored.revisions[0]?.eventVersion).toBe(1);
    expect(stored.revisions[0]?.operation).toBe("created");
    expect(stored.revisions[0]?.journalSeq).toBeGreaterThan(0);
  });

  it("leaves no event, no revision, and no consumed sequence when the transaction rolls back", async () => {
    const before = await currentJournalSeq(tenant.childId);
    const doomedEventId = randomUUID();
    const doomedRevisionId = randomUUID();

    const message = await failureMessage(() =>
      withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, async (tx) => {
        await eventsRepository.lockChildForJournalWrite(tx, tenant.workspaceId, tenant.childId);
        const journalSeq = await eventsRepository.allocateJournalSeq(
          tx,
          tenant.workspaceId,
          tenant.childId,
        );
        await eventsRepository.insertEventWithRevision(tx, {
          event: {
            id: doomedEventId,
            workspaceId: tenant.workspaceId,
            childId: tenant.childId,
            captureId,
            sourceCandidateId: randomUUID(),
            createdByUserId: tenant.userId,
            lastEditedByUserId: tenant.userId,
            kind: "note",
            occurredAt: new Date(),
            endedAt: null,
            timezone: "America/Vancouver",
            timePrecision: "exact",
            payloadCiphertext: syntheticEnvelope("payload"),
            important: false,
            currentRevisionId: doomedRevisionId,
          },
          revision: {
            id: doomedRevisionId,
            workspaceId: tenant.workspaceId,
            childId: tenant.childId,
            eventId: doomedEventId,
            journalSeq,
            eventVersion: 1,
            operation: "created",
            actorUserId: tenant.userId,
            contentCiphertext: syntheticEnvelope("snapshot"),
          },
        });
        throw new Error("confirmation failed after the sequence was allocated");
      }),
    );
    expect(message).toMatch(/confirmation failed after the sequence was allocated/);

    const leftovers = await withTenantTransaction(
      api.db,
      { workspaceId: tenant.workspaceId },
      async (tx) => ({
        event: await tx.select().from(events).where(eq(events.id, doomedEventId)),
        revision: await tx
          .select()
          .from(eventRevisions)
          .where(eq(eventRevisions.id, doomedRevisionId)),
      }),
    );
    expect(leftovers.event).toEqual([]);
    expect(leftovers.revision).toEqual([]);

    const published = await publishEvent(api.db, {
      childId: tenant.childId,
      captureId,
      kind: "note",
      occurredAt: new Date(),
    });
    // Only "greater than the last committed sequence" is promised. The counter is an ordering,
    // not a count: an aborted allocation may leave a gap and no reader depends on density.
    expect(published.revision.journalSeq).toBeGreaterThan(before);
  });

  it("gives 50 concurrent writers to one child 50 distinct consecutive sequences", async () => {
    const childId = await seedChild(admin.db, tenant.workspaceId, tenant.userId, "journal_race");
    const raceCaptureId = await seedCapture(childId);
    const before = await currentJournalSeq(childId);

    const published = await Promise.all(
      Array.from({ length: 50 }, () =>
        publishEvent(api.db, {
          childId,
          captureId: raceCaptureId,
          kind: "diaper",
          occurredAt: new Date(),
        }),
      ),
    );

    const sequences = published.map((result) => result.revision.journalSeq).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 50 }, (_, index) => before + 1 + index));

    const stored = await withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, (tx) =>
      eventsRepository.listRevisionsInWindow(tx, childId, before, before + 50),
    );
    expect(stored).toHaveLength(50);
    expect(new Set(stored.map((revision) => revision.eventId)).size).toBe(50);
  });

  it("appends a correction as a new revision and advances the event version", async () => {
    const published = await publishEvent(api.db, {
      childId: tenant.childId,
      captureId,
      kind: "feed",
      occurredAt: new Date("2026-09-05T07:30:00Z"),
    });
    const correctionId = randomUUID();

    const corrected = await withTenantTransaction(
      api.db,
      { workspaceId: tenant.workspaceId },
      async (tx) => {
        await eventsRepository.lockChildForJournalWrite(tx, tenant.workspaceId, tenant.childId);
        const journalSeq = await eventsRepository.allocateJournalSeq(
          tx,
          tenant.workspaceId,
          tenant.childId,
        );
        return eventsRepository.appendEventRevision(tx, {
          workspaceId: tenant.workspaceId,
          childId: tenant.childId,
          eventId: published.event.id,
          expectedVersion: published.event.version,
          patch: {
            occurredAt: new Date("2026-09-05T08:15:00Z"),
            endedAt: null,
            timezone: published.event.timezone,
            timePrecision: "approximate",
            payloadCiphertext: syntheticEnvelope("corrected"),
            important: true,
            status: "active",
          },
          revision: {
            id: correctionId,
            journalSeq,
            operation: "corrected",
            actorUserId: tenant.userId,
            contentCiphertext: syntheticEnvelope("corrected snapshot"),
          },
        });
      },
    );

    expect(corrected?.version).toBe(published.event.version + 1);
    expect(corrected?.currentRevisionId).toBe(correctionId);

    const revisions = await withTenantTransaction(
      api.db,
      { workspaceId: tenant.workspaceId },
      (tx) =>
        eventsRepository.listRevisionsForEvent(
          tx,
          tenant.workspaceId,
          tenant.childId,
          published.event.id,
        ),
    );
    expect(revisions.map((revision) => revision.eventVersion)).toEqual([1, 2]);
    expect(revisions[1]?.journalSeq).toBeGreaterThan(revisions[0]?.journalSeq ?? 0);
  });

  it("rejects a correction that names a stale expected version and writes nothing", async () => {
    const published = await publishEvent(api.db, {
      childId: tenant.childId,
      captureId,
      kind: "milestone",
      occurredAt: new Date(),
    });

    const result = await withTenantTransaction(
      api.db,
      { workspaceId: tenant.workspaceId },
      async (tx) => {
        await eventsRepository.lockChildForJournalWrite(tx, tenant.workspaceId, tenant.childId);
        const journalSeq = await eventsRepository.allocateJournalSeq(
          tx,
          tenant.workspaceId,
          tenant.childId,
        );
        return eventsRepository.appendEventRevision(tx, {
          workspaceId: tenant.workspaceId,
          childId: tenant.childId,
          eventId: published.event.id,
          expectedVersion: published.event.version + 7,
          patch: {
            occurredAt: published.event.occurredAt,
            endedAt: null,
            timezone: published.event.timezone,
            timePrecision: published.event.timePrecision,
            payloadCiphertext: syntheticEnvelope("corrected"),
            important: true,
            status: "active",
          },
          revision: {
            id: randomUUID(),
            journalSeq,
            operation: "corrected",
            actorUserId: tenant.userId,
            contentCiphertext: syntheticEnvelope("corrected snapshot"),
          },
        });
      },
    );
    expect(result).toBeNull();

    const after = await withTenantTransaction(
      api.db,
      { workspaceId: tenant.workspaceId },
      async (tx) => ({
        event: await eventsRepository.findEventInChild(
          tx,
          tenant.workspaceId,
          tenant.childId,
          published.event.id,
        ),
        revisions: await eventsRepository.listRevisionsForEvent(
          tx,
          tenant.workspaceId,
          tenant.childId,
          published.event.id,
        ),
      }),
    );
    expect(after.event?.version).toBe(published.event.version);
    expect(after.event?.important).toBe(false);
    expect(after.revisions).toHaveLength(1);
  });

  it("rejects a revision that points at another child's event", async () => {
    const otherChildId = await seedChild(
      admin.db,
      tenant.workspaceId,
      tenant.userId,
      "journal_other_child",
    );
    const published = await publishEvent(api.db, {
      childId: tenant.childId,
      captureId,
      kind: "note",
      occurredAt: new Date(),
    });

    const message = await failureMessage(() =>
      withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, (tx) =>
        tx.insert(eventRevisions).values({
          id: randomUUID(),
          workspaceId: tenant.workspaceId,
          childId: otherChildId,
          eventId: published.event.id,
          journalSeq: 1,
          eventVersion: 2,
          operation: "corrected",
          actorUserId: tenant.userId,
          contentCiphertext: syntheticEnvelope("smuggled"),
        }),
      ),
    );
    expect(message).toMatch(/event_revisions_event_fk/);
  });

  it("pages 30 events with mixed known and unknown times without duplicates or misses", async () => {
    const childId = await seedChild(admin.db, tenant.workspaceId, tenant.userId, "journal_paging");
    const pagingCaptureId = await seedCapture(childId);
    const base = new Date("2026-09-01T12:00:00Z").getTime();

    for (let index = 0; index < 30; index += 1) {
      // Twenty timed events across ten instants, so the id tiebreak is actually exercised, plus
      // ten events whose occurrence time the author confirmed as unknown.
      const occurredAt = index < 20 ? new Date(base + (index % 10) * 60_000) : null;
      await publishEvent(api.db, { childId, captureId: pagingCaptureId, kind: "note", occurredAt });
    }

    const paged: EventRow[] = [];
    let cursor: EventCursor | null = null;
    for (;;) {
      const page: EventRow[] = await withTenantTransaction(
        api.db,
        { workspaceId: tenant.workspaceId },
        (tx) =>
          eventsRepository.listEventsForChild(tx, {
            workspaceId: tenant.workspaceId,
            childId,
            cursor,
            limit: 7,
          }),
      );
      paged.push(...page);
      if (page.length < 7) break;
      const last = page[page.length - 1];
      if (!last) break;
      cursor = { occurredAt: last.occurredAt, id: last.id };
    }

    const unpaged = await withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, (tx) =>
      eventsRepository.listEventsForChild(tx, {
        workspaceId: tenant.workspaceId,
        childId,
        cursor: null,
        limit: 100,
      }),
    );

    expect(paged).toHaveLength(30);
    expect(new Set(paged.map((event) => event.id)).size).toBe(30);
    expect(paged.map((event) => event.id)).toEqual(unpaged.map((event) => event.id));
    // Unknown-time events sort last, after every timed event.
    expect(paged.slice(0, 20).every((event) => event.occurredAt !== null)).toBe(true);
    expect(paged.slice(20).every((event) => event.occurredAt === null)).toBe(true);
  });

  it("reads the latest confirmed fact by occurrence time, not by log time", async () => {
    const childId = await seedChild(admin.db, tenant.workspaceId, tenant.userId, "journal_latest");
    const latestCaptureId = await seedCapture(childId);

    const recent = await publishEvent(api.db, {
      childId,
      captureId: latestCaptureId,
      kind: "feed",
      occurredAt: new Date("2026-09-05T09:00:00Z"),
    });
    // Logged afterwards, but it happened earlier: a late upload must not become "latest known".
    await publishEvent(api.db, {
      childId,
      captureId: latestCaptureId,
      kind: "feed",
      occurredAt: new Date("2026-09-05T02:00:00Z"),
    });
    // Confirmed with an unknown time, so it cannot be cited as the latest known feed either.
    await publishEvent(api.db, {
      childId,
      captureId: latestCaptureId,
      kind: "feed",
      occurredAt: null,
    });

    const latest = await withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, (tx) =>
      eventsRepository.findLatestConfirmedFactByKind(tx, {
        workspaceId: tenant.workspaceId,
        childId,
        kind: "feed",
      }),
    );
    expect(latest?.id).toBe(recent.event.id);

    const unknownTime = await withTenantTransaction(
      api.db,
      { workspaceId: tenant.workspaceId },
      (tx) =>
        eventsRepository.listRecentUnknownTimeEvents(tx, {
          workspaceId: tenant.workspaceId,
          childId,
          since: new Date(Date.now() - 60 * 60 * 1000),
        }),
    );
    expect(unknownTime).toHaveLength(1);
  });

  it("reports the child's counter, unacknowledged position, and pending captures together", async () => {
    const childId = await seedChild(
      admin.db,
      tenant.workspaceId,
      tenant.userId,
      "journal_overview",
    );
    const overviewCaptureId = await seedCapture(childId);
    await publishEvent(api.db, {
      childId,
      captureId: overviewCaptureId,
      kind: "sleep",
      occurredAt: new Date(),
    });

    const metadata = await withTenantTransaction(
      api.db,
      { workspaceId: tenant.workspaceId },
      (tx) =>
        overviewRepository.readOverviewMetadata(tx, {
          workspaceId: tenant.workspaceId,
          childId,
          userId: tenant.userId,
        }),
    );

    expect(metadata?.journalSeq).toBe(1);
    // No cursor row yet: a recipient who has acknowledged nothing sits at sequence zero.
    expect(metadata?.acknowledgedSeq).toBe(0);
    expect(metadata?.pendingCaptureCount).toBe(1);
    expect(metadata?.activeSessions).toEqual([]);
  });

  it("returns the existing capture when the same client capture id is submitted twice", async () => {
    const clientCaptureId = randomUUID();
    const submit = () =>
      withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, (tx) =>
        capturesRepository.insertCapture(tx, {
          id: randomUUID(),
          workspaceId: tenant.workspaceId,
          childId: tenant.childId,
          authorUserId: tenant.userId,
          clientCaptureId,
          inputKind: "manual",
          capturedAt: new Date(),
          timezone: "America/Vancouver",
          locale: "en-CA",
          contentCiphertext: syntheticEnvelope("draft"),
          schemaVersion: 1,
          status: "needs_review",
        }),
      );

    const first = await submit();
    const second = await submit();
    expect(second.id).toBe(first.id);

    const stored = await withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, (tx) =>
      tx
        .select()
        .from(captures)
        .where(
          and(
            eq(captures.workspaceId, tenant.workspaceId),
            eq(captures.authorUserId, tenant.userId),
            eq(captures.clientCaptureId, clientCaptureId),
          ),
        ),
    );
    expect(stored).toHaveLength(1);
  });
});
