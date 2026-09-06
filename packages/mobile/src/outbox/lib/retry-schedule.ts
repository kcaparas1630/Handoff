import type { OutboxFailure } from "../types/outbox";

/** architecture.md section 4: bounded automatic retries, then a visible retry/manual-entry path. */
export const MAX_AUTOMATIC_ATTEMPTS = 5;

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

/**
 * Server codes that will not change on their own: a revoked grant, a missing capture, or a file
 * the API refuses. Retrying them only burns battery, so they surface to the caregiver at once.
 */
const terminalErrorCodes: readonly string[] = [
  "forbidden",
  "not_found",
  "validation_failed",
  "unauthorized",
];

export function isTerminalUploadError(errorCode: string): boolean {
  return terminalErrorCodes.includes(errorCode);
}

/** Doubling backoff, capped. Deterministic so the schedule can be asserted in tests. */
export function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS);
}

/**
 * Decides what one failed attempt means for the row: wait and retry, or stop and ask. The caller
 * writes the result; this function reads no clock of its own.
 */
export function planRetry(input: {
  errorCode: string;
  previousAttempts: number;
  now: Date;
}): OutboxFailure {
  const attempts = input.previousAttempts + 1;
  if (isTerminalUploadError(input.errorCode) || attempts >= MAX_AUTOMATIC_ATTEMPTS) {
    return { errorCode: input.errorCode, attempts, nextAttemptAt: null, isTerminal: true };
  }
  const nextAttemptAt = new Date(input.now.getTime() + retryDelayMs(attempts)).toISOString();
  return { errorCode: input.errorCode, attempts, nextAttemptAt, isTerminal: false };
}

/** A row is due when it has never been retried or its backoff window has passed. */
export function isAttemptDue(nextAttemptAt: string | null, now: Date): boolean {
  if (nextAttemptAt === null) return true;
  const due = Date.parse(nextAttemptAt);
  return Number.isNaN(due) || due <= now.getTime();
}
