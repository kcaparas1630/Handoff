import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { jobs } from "../schema";
import type { HandoffTransaction } from "../types/database";
import type {
  ClaimJobInput,
  EnqueueJobInput,
  EnqueueJobResult,
  JobFailure,
  JobRow,
  LeasedJobWrite,
} from "../types/jobs";

// The durable queue. Claims take a lease and commit before any external call; every later write
// by that worker names the lease token it was issued, so a worker whose lease expired mid-call
// cannot overwrite the attempt that replaced it.
//
// These statements run on the dispatcher credential (DATABASE_JOB_DISPATCH_URL). The API role can
// only enqueue and read jobs inside its own tenant; claiming is not a mobile API capability.

// The instant is passed as text and cast: a bare Date parameter has no column to take its type
// from here, and the driver needs the explicit timestamptz.
function leaseExpiry(from: Date, leaseMs: number) {
  return sql`${from.toISOString()}::timestamptz + make_interval(secs => ${leaseMs}::double precision / 1000)`;
}

/**
 * At-most-one row per dedupe key. `created` is false when the unit of work was already queued,
 * which is how a retried request avoids scheduling the same processing twice.
 */
export async function enqueueJob(
  tx: HandoffTransaction,
  input: EnqueueJobInput,
): Promise<EnqueueJobResult> {
  const [inserted] = await tx
    .insert(jobs)
    .values({
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      workspaceId: input.workspaceId ?? null,
      childId: input.childId ?? null,
      captureId: input.captureId ?? null,
      assetId: input.assetId ?? null,
      payload: input.payload,
      ...(input.availableAt === undefined ? {} : { availableAt: input.availableAt }),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning();
  if (inserted) return { job: inserted, created: true };

  const existing = await findJobByDedupeKey(tx, input.dedupeKey);
  if (!existing) throw new Error("job insert conflicted but no matching job is present");
  return { job: existing, created: false };
}

export async function findJobByDedupeKey(
  tx: HandoffTransaction,
  dedupeKey: string,
): Promise<JobRow | null> {
  const [row] = await tx.select().from(jobs).where(eq(jobs.dedupeKey, dedupeKey)).limit(1);
  return row ?? null;
}

/**
 * Takes the oldest available job of the requested kinds in one statement. SKIP LOCKED lets
 * concurrent workers pass over each other's candidates instead of queueing behind them, so N
 * simultaneous claims against M available jobs produce min(N, M) distinct leases.
 */
export async function claimNextJob(
  tx: HandoffTransaction,
  input: ClaimJobInput,
): Promise<JobRow | null> {
  const candidate = tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "queued"),
        lte(jobs.availableAt, input.now),
        inArray(jobs.kind, input.kinds),
      ),
    )
    .orderBy(asc(jobs.availableAt), asc(jobs.createdAt))
    .limit(1)
    .for("update", { skipLocked: true });

  const [row] = await tx
    .update(jobs)
    .set({
      status: "leased",
      leaseToken: input.leaseToken,
      leaseExpiresAt: leaseExpiry(input.now, input.leaseMs),
      // Counted at claim time, so a worker that crashes without reporting still consumes one.
      attempts: sql`${jobs.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(sql`${jobs.id} = (${candidate})`)
    .returning();
  return row ?? null;
}

/** A crashed worker's lease eventually expires and its job becomes claimable again. */
export async function reclaimExpiredLeases(tx: HandoffTransaction, now: Date): Promise<string[]> {
  const rows = await tx
    .update(jobs)
    .set({
      status: "queued",
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(jobs.status, "leased"), lt(jobs.leaseExpiresAt, now)))
    .returning({ id: jobs.id });
  return rows.map((row) => row.id);
}

/** False once the lease has been reclaimed: this worker is no longer the one holding the job. */
export async function heartbeatJob(
  tx: HandoffTransaction,
  input: LeasedJobWrite & { leaseMs: number },
): Promise<boolean> {
  const rows = await tx
    .update(jobs)
    .set({ leaseExpiresAt: leaseExpiry(new Date(), input.leaseMs), updatedAt: sql`now()` })
    .where(leaseHeld(input))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/**
 * Stage markers only. Persisting that transcription finished is what lets an extraction retry
 * skip it; the transcript itself stays in the encrypted capture, never in this column.
 */
export async function saveJobCheckpoint(
  tx: HandoffTransaction,
  input: LeasedJobWrite & { checkpoint: unknown },
): Promise<boolean> {
  const rows = await tx
    .update(jobs)
    .set({ checkpoint: input.checkpoint, updatedAt: sql`now()` })
    .where(leaseHeld(input))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export async function completeJob(
  tx: HandoffTransaction,
  input: LeasedJobWrite,
): Promise<JobRow | null> {
  const [row] = await tx
    .update(jobs)
    .set({
      status: "succeeded",
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(leaseHeld(input))
    .returning();
  return row ?? null;
}

/**
 * A null `retryAt` is a terminal failure: permission errors and invalid files are not retried.
 * Otherwise the job returns to the queue until the attempt budget is spent, which the claim
 * already counted, so the attempt that reaches max_attempts fails terminally here.
 */
export async function failJob(tx: HandoffTransaction, input: JobFailure): Promise<JobRow | null> {
  const retryAt = input.retryAt;
  const exhausted = retryAt === null ? sql`true` : sql`${jobs.attempts} >= ${jobs.maxAttempts}`;
  const [row] = await tx
    .update(jobs)
    .set({
      // The cast is explicit: a bare CASE over string literals is text, not the status enum.
      status: sql`(case when ${exhausted} then 'failed' else 'queued' end)::"handoff"."job_status"`,
      ...(retryAt === null
        ? {}
        : {
            availableAt: sql`case when ${exhausted} then ${jobs.availableAt} else ${retryAt.toISOString()}::timestamptz end`,
          }),
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: input.errorCode,
      updatedAt: sql`now()`,
    })
    .where(leaseHeld(input))
    .returning();
  return row ?? null;
}

/**
 * Discarding a capture stops its queued work. Unlike the calls above this is not a lease holder,
 * so it clears the token: a worker mid-attempt then fails every write it tries afterwards.
 */
export async function cancelJobsForCapture(
  tx: HandoffTransaction,
  input: { workspaceId: string; captureId: string },
): Promise<string[]> {
  const rows = await tx
    .update(jobs)
    .set({
      status: "cancelled",
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(jobs.workspaceId, input.workspaceId),
        eq(jobs.captureId, input.captureId),
        inArray(jobs.status, ["queued", "leased"]),
      ),
    )
    .returning({ id: jobs.id });
  return rows.map((row) => row.id);
}

/** The predicate every lease-holder write shares. */
function leaseHeld(input: LeasedJobWrite) {
  return and(
    eq(jobs.id, input.jobId),
    eq(jobs.leaseToken, input.leaseToken),
    eq(jobs.status, "leased"),
  );
}
