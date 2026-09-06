import { describe, expect, it } from "vitest";
import { nextRetryDelayMs } from "./backoff";

describe("nextRetryDelayMs", () => {
  it("grows with each attempt", () => {
    const first = nextRetryDelayMs({ attempts: 1, jitter: 1 });
    const second = nextRetryDelayMs({ attempts: 2, jitter: 1 });
    const third = nextRetryDelayMs({ attempts: 3, jitter: 1 });
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("spreads a batch of failures apart with jitter", () => {
    expect(nextRetryDelayMs({ attempts: 2, jitter: 0 })).toBeLessThan(
      nextRetryDelayMs({ attempts: 2, jitter: 1 }),
    );
  });

  it("never retries sooner than the provider's Retry-After", () => {
    expect(nextRetryDelayMs({ attempts: 1, jitter: 0, retryAfterMs: 45_000 })).toBe(45_000);
  });

  it("keeps its own backoff when it is already longer than Retry-After", () => {
    expect(nextRetryDelayMs({ attempts: 1, jitter: 0, retryAfterMs: 10 })).toBeGreaterThan(10);
  });

  it("stops growing at its ceiling", () => {
    expect(nextRetryDelayMs({ attempts: 40, jitter: 1 })).toBe(60_000);
  });
});
