// Retry pacing. Pure: the caller supplies the jitter sample, so a test can pin it.

const BASE_MS = 2_000;
const MAX_MS = 60_000;

export interface BackoffInput {
  /** Attempts already made, counted at claim time. */
  attempts: number;
  /** From the provider's `Retry-After`, which the architecture requires us to respect. */
  retryAfterMs?: number | undefined;
  /** A sample in [0, 1). Jitter keeps a batch of failures from retrying in lockstep. */
  jitter: number;
}

export function nextRetryDelayMs({ attempts, retryAfterMs, jitter }: BackoffInput): number {
  const exponential = Math.min(BASE_MS * 2 ** Math.max(attempts - 1, 0), MAX_MS);
  const jittered = Math.round(exponential * (0.5 + jitter * 0.5));
  // A provider that asked for a longer wait gets it; we never retry sooner than it allowed.
  if (retryAfterMs === undefined) return jittered;
  return Math.max(jittered, retryAfterMs);
}
