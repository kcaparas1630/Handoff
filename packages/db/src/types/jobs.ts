import type { JobKind, JobStatus } from "./enums";

export interface JobRow {
  id: string;
  kind: JobKind;
  dedupeKey: string;
  status: JobStatus;
  workspaceId: string | null;
  childId: string | null;
  captureId: string | null;
  assetId: string | null;
  // Identifiers and stage arguments; never transcript text.
  payload: unknown;
  // Stage markers only; never transcript text.
  checkpoint: unknown;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueJobInput {
  kind: JobKind;
  dedupeKey: string;
  workspaceId?: string | null;
  childId?: string | null;
  captureId?: string | null;
  assetId?: string | null;
  payload: unknown;
  availableAt?: Date;
  maxAttempts?: number;
}

/** `created` is false when the dedupe key already existed, so the caller can skip its side effects. */
export interface EnqueueJobResult {
  job: JobRow;
  created: boolean;
}

export interface ClaimJobInput {
  kinds: JobKind[];
  now: Date;
  leaseMs: number;
  leaseToken: string;
}

/** Every lease-holder write carries the token it was issued, so a superseded worker writes nothing. */
export interface LeasedJobWrite {
  jobId: string;
  leaseToken: string;
}

export interface JobFailure extends LeasedJobWrite {
  errorCode: string;
  /** Null means give up now; otherwise the job returns to `queued` and waits until this instant. */
  retryAt: Date | null;
}
