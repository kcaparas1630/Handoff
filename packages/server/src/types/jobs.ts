import type { JobKind, JobRow } from "@handoff/db";
import type { WorkerRuntime } from "./runtime";

/** What a handler is given. The workspace comes from the claimed row, never from a caller. */
export interface JobContext {
  runtime: WorkerRuntime;
  job: JobRow;
  leaseToken: string;
  /**
   * Records a stage marker under this lease. False means the lease was reclaimed and a newer
   * attempt owns the job, so the handler should stop writing.
   */
  saveCheckpoint: (checkpoint: unknown) => Promise<boolean>;
}

/**
 * Handlers report an outcome instead of throwing, so the difference between "retry this" and
 * "this will never work" is part of the contract rather than an exception hierarchy.
 */
export type JobOutcome =
  | { status: "completed" }
  | {
      status: "failed";
      /** A short code such as `transcription_failed`; never a provider message. */
      errorCode: string;
      retryable: boolean;
      retryAfterMs?: number;
    };

export type JobHandler = (context: JobContext) => Promise<JobOutcome>;

export interface JobRunnerOptions {
  runtime: WorkerRuntime;
  handlers: Partial<Record<JobKind, JobHandler>>;
  concurrency: number;
  leaseMs: number;
  pollIntervalMs?: number;
  heartbeatMs?: number;
}

export interface JobRunner {
  /** Claims and runs at most `concurrency` jobs once. Returns how many ran. */
  runOnce: () => Promise<number>;
  start: () => void;
  /** Stops claiming and waits for the handlers already running. */
  stop: () => Promise<void>;
}
