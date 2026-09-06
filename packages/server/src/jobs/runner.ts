// The durable work loop. Claims commit before any external call, every write names the lease
// token the claim issued, and a crashed lease becomes claimable again (architecture §4).
import { randomUUID } from "node:crypto";
import { jobsRepository, withJobTransaction } from "@handoff/db";
import { ProviderError } from "../lib/provider-error";
import { nextRetryDelayMs } from "./lib/backoff";
import type { JobKind, JobRow } from "@handoff/db";
import type {
  JobContext,
  JobHandler,
  JobOutcome,
  JobRunner,
  JobRunnerOptions,
} from "../types/jobs";
import type { WorkerRuntime } from "../types/runtime";

const DEFAULT_POLL_INTERVAL_MS = 1_000;

/** Renewed well inside the lease so a slow provider call does not lose the job mid-flight. */
const DEFAULT_HEARTBEAT_DIVISOR = 3;

export function createJobRunner({
  runtime,
  handlers,
  concurrency,
  leaseMs,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  heartbeatMs = Math.max(Math.floor(leaseMs / DEFAULT_HEARTBEAT_DIVISOR), 1_000),
}: JobRunnerOptions): JobRunner {
  const kinds = Object.keys(handlers) as JobKind[];
  const inFlight = new Set<Promise<void>>();
  let stopping = false;
  let loop: Promise<void> | null = null;
  let wakeUp: (() => void) | null = null;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(finish, ms);
      wakeUp = finish;
      function finish() {
        clearTimeout(timer);
        wakeUp = null;
        resolve();
      }
    });
  }

  async function claim(): Promise<JobRow | null> {
    // The claim is its own committed transaction: nothing external happens inside it.
    return withJobTransaction(runtime.jobsDb, (tx) =>
      jobsRepository.claimNextJob(tx, {
        kinds,
        now: runtime.now(),
        leaseMs,
        leaseToken: randomUUID(),
      }),
    );
  }

  async function runOnce(): Promise<number> {
    if (kinds.length === 0) return 0;
    await withJobTransaction(runtime.jobsDb, (tx) =>
      jobsRepository.reclaimExpiredLeases(tx, runtime.now()),
    );

    let started = 0;
    while (inFlight.size < concurrency) {
      const job = await claim();
      if (job === null) break;
      started += 1;
      const running = run(job).finally(() => inFlight.delete(running));
      inFlight.add(running);
    }
    // runOnce is the deterministic unit the tests drive, so it waits for what it started.
    await Promise.all([...inFlight]);
    return started;
  }

  async function run(job: JobRow): Promise<void> {
    const handler = handlers[job.kind];
    const leaseToken = job.leaseToken;
    if (handler === undefined || leaseToken === null) return;

    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      void withJobTransaction(runtime.jobsDb, (tx) =>
        jobsRepository.heartbeatJob(tx, { jobId: job.id, leaseToken, leaseMs }),
      ).catch(() => {
        // A missed heartbeat is not fatal: the lease either survives or the job is reclaimed.
      });
    }, heartbeatMs);

    try {
      const outcome = await execute(handler, buildContext(runtime, job, leaseToken));
      await record(job, leaseToken, outcome);
      logJob(job, outcome, Date.now() - startedAt);
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function record(job: JobRow, leaseToken: string, outcome: JobOutcome): Promise<void> {
    await withJobTransaction(runtime.jobsDb, async (tx) => {
      if (outcome.status === "completed") {
        await jobsRepository.completeJob(tx, { jobId: job.id, leaseToken });
        return;
      }
      const retryAt = outcome.retryable
        ? new Date(
            runtime.now().getTime() +
              nextRetryDelayMs({
                attempts: job.attempts,
                retryAfterMs: outcome.retryAfterMs,
                jitter: Math.random(),
              }),
          )
        : null;
      await jobsRepository.failJob(tx, {
        jobId: job.id,
        leaseToken,
        errorCode: outcome.errorCode,
        retryAt,
      });
    });
  }

  return {
    runOnce,
    start() {
      if (loop !== null) return;
      loop = (async () => {
        while (!stopping) {
          try {
            await runOnce();
          } catch (error) {
            logRunnerError(error);
          }
          if (!stopping) await sleep(pollIntervalMs);
        }
      })();
    },
    async stop() {
      stopping = true;
      wakeUp?.();
      await loop;
      await Promise.all([...inFlight]);
      loop = null;
    },
  };
}

function buildContext(runtime: WorkerRuntime, job: JobRow, leaseToken: string): JobContext {
  return {
    runtime,
    job,
    leaseToken,
    saveCheckpoint: (checkpoint) =>
      withJobTransaction(runtime.jobsDb, (tx) =>
        jobsRepository.saveJobCheckpoint(tx, { jobId: job.id, leaseToken, checkpoint }),
      ),
  };
}

/**
 * A handler that throws is treated as a transient fault so the attempt budget still applies; a
 * provider that told us it will not succeed is terminal. Encryption failures are terminal by
 * contract: there is no plaintext fallback (docs/pii-encryption.md).
 */
async function execute(handler: JobHandler, context: JobContext): Promise<JobOutcome> {
  try {
    return await handler(context);
  } catch (error) {
    if (error instanceof ProviderError) {
      return {
        status: "failed",
        errorCode: error.code,
        retryable: error.retryable,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      };
    }
    return { status: "failed", errorCode: "unknown", retryable: true };
  }
}

/** Job id, kind, outcome, and duration only. A transcript never reaches a log. */
function logJob(job: JobRow, outcome: JobOutcome, durationMs: number): void {
  const detail =
    outcome.status === "completed"
      ? { result: "completed" }
      : { result: "failed", errorCode: outcome.errorCode, retryable: outcome.retryable };
  console.info(
    JSON.stringify({
      event: "job",
      jobId: job.id,
      kind: job.kind,
      attempts: job.attempts,
      durationMs,
      ...detail,
    }),
  );
}

function logRunnerError(error: unknown): void {
  console.error(
    JSON.stringify({
      event: "job_runner_error",
      error: error instanceof Error ? error.name : "UnknownError",
    }),
  );
}
