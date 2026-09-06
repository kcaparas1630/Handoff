import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient } from "../../packages/db/src/client";
import * as jobsRepository from "../../packages/db/src/repositories/jobs";
import { captures, jobs } from "../../packages/db/src/schema";
import {
  withJobTransaction,
  withTenantTransaction,
} from "../../packages/db/src/tenant-transaction";
import type { DbClient } from "../../packages/db/src/client";
import type { JobKind } from "../../packages/db/src/types/enums";
import type { EnqueueJobInput, JobRow } from "../../packages/db/src/types/jobs";
import type { SeededTenant, TestDatabase } from "./support/test-database";
import {
  createTestDatabase,
  failureMessage,
  missingDatabaseUrlMessage,
  seedTenant,
} from "./support/test-database";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL) {
  console.warn(`Skipping job queue tests. ${missingDatabaseUrlMessage}`);
}

const leaseMs = 30_000;

describeIntegration("durable job queue", () => {
  let database: TestDatabase;
  let admin: DbClient;
  /** Queue credential: the only role allowed to take a lease. */
  let dispatcher: DbClient;
  let tenant: SeededTenant;

  function enqueue(dedupeKey: string, overrides: Partial<EnqueueJobInput> = {}) {
    return withJobTransaction(dispatcher.db, (tx) =>
      jobsRepository.enqueueJob(tx, {
        kind: "process_capture",
        dedupeKey,
        workspaceId: tenant.workspaceId,
        childId: tenant.childId,
        payload: { childId: tenant.childId },
        ...overrides,
      }),
    );
  }

  function claim(now: Date, kinds: JobKind[] = ["process_capture"]) {
    return withJobTransaction(dispatcher.db, (tx) =>
      jobsRepository.claimNextJob(tx, { kinds, now, leaseMs, leaseToken: randomUUID() }),
    );
  }

  function readJob(jobId: string) {
    return withJobTransaction(admin.db, async (tx) => {
      const [row] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      return row ?? null;
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    admin = createDbClient({ url: database.adminUrl, maxConnections: 4 });
    dispatcher = createDbClient({ url: database.dispatcherUrl, maxConnections: 24 });
    tenant = await seedTenant(admin.db, "jobs_tenant");
  }, 60_000);

  // Claims scan the whole queue, so each test starts from an empty one. Only the superuser test
  // connection can do this: neither runtime role is granted DELETE.
  beforeEach(async () => {
    await withJobTransaction(admin.db, (tx) => tx.delete(jobs));
  });

  afterAll(async () => {
    await dispatcher?.close();
    await admin?.close();
    await database?.drop();
  });

  it("keeps one row per dedupe key", async () => {
    const first = await enqueue("capture-1");
    const second = await enqueue("capture-1");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);

    const found = await withJobTransaction(dispatcher.db, (tx) =>
      jobsRepository.findJobByDedupeKey(tx, "capture-1"),
    );
    expect(found?.id).toBe(first.job.id);
  });

  it("gives twenty concurrent workers five distinct jobs and fifteen empty claims", async () => {
    const available = 5;
    for (let index = 0; index < available; index += 1) {
      await enqueue(`concurrent-${index}`);
    }

    const now = new Date();
    const claims = await Promise.all(Array.from({ length: 20 }, () => claim(now)));

    const claimed = claims.filter((job): job is JobRow => job !== null);
    expect(claimed).toHaveLength(available);
    expect(claims.filter((job) => job === null)).toHaveLength(20 - available);
    expect(new Set(claimed.map((job) => job.id)).size).toBe(available);
    // Every winner holds its own lease and has spent exactly one attempt.
    expect(new Set(claimed.map((job) => job.leaseToken)).size).toBe(available);
    expect(claimed.every((job) => job.status === "leased" && job.attempts === 1)).toBe(true);
  });

  it("never claims a kind the worker did not ask for", async () => {
    await enqueue("other-kind", { kind: "reconcile_clerk", workspaceId: null, childId: null });

    expect(await claim(new Date(), ["cleanup_audio"])).toBeNull();
    expect((await claim(new Date(), ["reconcile_clerk"]))?.dedupeKey).toBe("other-kind");
  });

  it("does not claim a job before its availability time", async () => {
    const later = new Date(Date.now() + 60 * 60 * 1000);
    await enqueue("scheduled", { availableAt: later });

    expect(await claim(new Date())).toBeNull();
    expect((await claim(new Date(later.getTime() + 1000)))?.dedupeKey).toBe("scheduled");
  });

  it("reclaims a crashed worker's expired lease exactly once", async () => {
    const claimedAt = new Date(Date.now() - 10 * 60 * 1000);
    const { job } = await enqueue("crashed", { availableAt: claimedAt });
    // A worker that died holding the lease: claimed in the past, with a lease that has expired.
    const leased = await withJobTransaction(dispatcher.db, (tx) =>
      jobsRepository.claimNextJob(tx, {
        kinds: ["process_capture"],
        now: claimedAt,
        leaseMs: 1000,
        leaseToken: randomUUID(),
      }),
    );
    expect(leased?.id).toBe(job.id);
    expect(await claim(new Date())).toBeNull();

    const now = new Date();
    const reclaimed = await withJobTransaction(dispatcher.db, (tx) =>
      jobsRepository.reclaimExpiredLeases(tx, now),
    );
    expect(reclaimed).toEqual([job.id]);

    const again = await withJobTransaction(dispatcher.db, (tx) =>
      jobsRepository.reclaimExpiredLeases(tx, now),
    );
    expect(again).toEqual([]);

    const reclaimedClaim = await claim(now);
    expect(reclaimedClaim?.id).toBe(job.id);
    // The crashed attempt is still counted: a reclaim is not a fresh retry budget.
    expect(reclaimedClaim?.attempts).toBe(2);
  });

  it("rejects every write from a worker whose lease was replaced", async () => {
    const { job } = await enqueue("stale-lease");
    const leased = await claim(new Date());
    expect(leased?.id).toBe(job.id);
    const staleToken = randomUUID();

    const results = await withJobTransaction(dispatcher.db, async (tx) => ({
      heartbeat: await jobsRepository.heartbeatJob(tx, {
        jobId: job.id,
        leaseToken: staleToken,
        leaseMs,
      }),
      checkpoint: await jobsRepository.saveJobCheckpoint(tx, {
        jobId: job.id,
        leaseToken: staleToken,
        checkpoint: { stage: "transcribed" },
      }),
      completed: await jobsRepository.completeJob(tx, { jobId: job.id, leaseToken: staleToken }),
      failed: await jobsRepository.failJob(tx, {
        jobId: job.id,
        leaseToken: staleToken,
        errorCode: "stale",
        retryAt: null,
      }),
    }));

    expect(results.heartbeat).toBe(false);
    expect(results.checkpoint).toBe(false);
    expect(results.completed).toBeNull();
    expect(results.failed).toBeNull();

    const after = await readJob(job.id);
    expect(after?.status).toBe("leased");
    expect(after?.leaseToken).toBe(leased?.leaseToken);
    expect(after?.checkpoint).toBeNull();
    expect(after?.lastErrorCode).toBeNull();
  });

  it("accepts checkpoints, heartbeats, and completion from the current lease holder", async () => {
    const { job } = await enqueue("current-lease");
    const leased = await claim(new Date());
    const leaseToken = leased?.leaseToken ?? "";

    const saved = await withJobTransaction(dispatcher.db, async (tx) => ({
      heartbeat: await jobsRepository.heartbeatJob(tx, { jobId: job.id, leaseToken, leaseMs }),
      // Stage markers only: the transcript itself never leaves the encrypted capture.
      checkpoint: await jobsRepository.saveJobCheckpoint(tx, {
        jobId: job.id,
        leaseToken,
        checkpoint: { stage: "transcribed", providerRequestId: "req_1" },
      }),
    }));
    expect(saved).toEqual({ heartbeat: true, checkpoint: true });

    const completed = await withJobTransaction(dispatcher.db, (tx) =>
      jobsRepository.completeJob(tx, { jobId: job.id, leaseToken }),
    );
    expect(completed?.status).toBe("succeeded");
    expect(completed?.leaseToken).toBeNull();
    expect(completed?.checkpoint).toEqual({ stage: "transcribed", providerRequestId: "req_1" });
  });

  it("retries a failure until the attempt budget is spent, then fails terminally", async () => {
    const { job } = await enqueue("retried");
    const retryAt = new Date(Date.now() - 1000);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const leased = await claim(new Date());
      expect(leased?.id).toBe(job.id);
      expect(leased?.attempts).toBe(attempt);
      const failed = await withJobTransaction(dispatcher.db, (tx) =>
        jobsRepository.failJob(tx, {
          jobId: job.id,
          leaseToken: leased?.leaseToken ?? "",
          errorCode: "provider_timeout",
          retryAt,
        }),
      );
      expect(failed?.status).toBe("queued");
      expect(failed?.availableAt.getTime()).toBe(retryAt.getTime());
      expect(failed?.lastErrorCode).toBe("provider_timeout");
    }

    const lastAttempt = await claim(new Date());
    expect(lastAttempt?.attempts).toBe(3);
    const exhausted = await withJobTransaction(dispatcher.db, (tx) =>
      jobsRepository.failJob(tx, {
        jobId: job.id,
        leaseToken: lastAttempt?.leaseToken ?? "",
        errorCode: "provider_timeout",
        retryAt,
      }),
    );
    expect(exhausted?.status).toBe("failed");
    expect(await claim(new Date())).toBeNull();
  });

  it("fails terminally without a retry when the error is not transient", async () => {
    const { job } = await enqueue("terminal");
    const leased = await claim(new Date());
    const failed = await withJobTransaction(dispatcher.db, (tx) =>
      jobsRepository.failJob(tx, {
        jobId: job.id,
        leaseToken: leased?.leaseToken ?? "",
        errorCode: "invalid_file",
        retryAt: null,
      }),
    );
    expect(failed?.status).toBe("failed");
    expect(failed?.attempts).toBe(1);
    expect(await claim(new Date())).toBeNull();
  });

  it("cancels a discarded capture's queued and leased work", async () => {
    const captureId = await seedCapture(admin, tenant);
    await enqueue("cancel-queued", { captureId });
    await enqueue("cancel-leased", { captureId });
    const leased = await claim(new Date());

    const cancelled = await withJobTransaction(dispatcher.db, (tx) =>
      jobsRepository.cancelJobsForCapture(tx, { workspaceId: tenant.workspaceId, captureId }),
    );
    expect(cancelled).toHaveLength(2);

    // The worker mid-attempt loses its lease, so the writes it tries afterwards do nothing.
    const write = await withJobTransaction(dispatcher.db, (tx) =>
      jobsRepository.saveJobCheckpoint(tx, {
        jobId: leased?.id ?? "",
        leaseToken: leased?.leaseToken ?? "",
        checkpoint: { stage: "transcribed" },
      }),
    );
    expect(write).toBe(false);
    expect(await claim(new Date())).toBeNull();
  });

  it("shows the API credential only its own tenant's jobs and the dispatcher every job", async () => {
    const other = await seedTenant(admin.db, "jobs_other_tenant");
    await enqueue("visible-a");
    await enqueue("visible-b", { workspaceId: other.workspaceId, childId: other.childId });
    await enqueue("visible-global", {
      kind: "reconcile_clerk",
      workspaceId: null,
      childId: null,
    });

    const api = createDbClient({ url: database.apiUrl, maxConnections: 2 });
    try {
      const mine = await withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, (tx) =>
        tx.select({ id: jobs.id, workspaceId: jobs.workspaceId }).from(jobs),
      );
      expect(mine).toHaveLength(1);
      expect(mine[0]?.workspaceId).toBe(tenant.workspaceId);

      // Enqueuing into another workspace fails the policy's WITH CHECK, not an application rule.
      const message = await failureMessage(() =>
        withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, (tx) =>
          jobsRepository.enqueueJob(tx, {
            kind: "purge_child",
            dedupeKey: "cross-tenant",
            workspaceId: other.workspaceId,
            childId: other.childId,
            payload: {},
          }),
        ),
      );
      expect(message).toMatch(/row-level security/i);
    } finally {
      await api.close();
    }

    const everything = await withJobTransaction(dispatcher.db, (tx) =>
      tx.select({ workspaceId: jobs.workspaceId }).from(jobs),
    );
    const workspaceIds = new Set(everything.map((row) => row.workspaceId));
    expect(workspaceIds).toEqual(new Set([tenant.workspaceId, other.workspaceId, null]));
  });

  it("keeps the dispatcher out of every table except the queue", async () => {
    const session = postgres(database.dispatcherUrl, { max: 1, prepare: false });
    try {
      await expect(session`select count(*) from handoff.captures`).rejects.toThrow(/permission/i);
      await expect(session`select count(*) from handoff.media_assets`).rejects.toThrow(
        /permission/i,
      );
      await expect(session`select count(*) from handoff.children`).rejects.toThrow(/permission/i);
    } finally {
      await session.end();
    }
  });
});

/** A capture for the jobs that reference one. Written as admin: this file is about the queue. */
async function seedCapture(admin: DbClient, tenant: SeededTenant): Promise<string> {
  const captureId = randomUUID();
  await withTenantTransaction(admin.db, { workspaceId: tenant.workspaceId }, (tx) =>
    tx.insert(captures).values({
      id: captureId,
      workspaceId: tenant.workspaceId,
      childId: tenant.childId,
      authorUserId: tenant.userId,
      clientCaptureId: randomUUID(),
      inputKind: "audio",
      capturedAt: new Date(),
      timezone: "America/Vancouver",
      locale: "en-CA",
      schemaVersion: 1,
      status: "queued",
    }),
  );
  return captureId;
}
