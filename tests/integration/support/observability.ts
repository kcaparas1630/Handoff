// The observability and limit fields every runtime and service-deps literal needs. Tests keep a
// silent logger by default and can pass a collector to assert on what a line would have carried.
import { createLogger } from "../../../packages/server/src/observability/logger";
import { createMetrics } from "../../../packages/server/src/observability/metrics";
import type { RuntimeLimits } from "../../../packages/server/src/types/runtime";
import type { Logger, MetricsRegistry } from "../../../packages/server/src/types/observability";

/** Generous enough that no existing test meets a ceiling by accident. */
export const TEST_LIMITS: RuntimeLimits = {
  capturesPerUserPerDay: 200,
  audioSecondsPerWorkspacePerDay: 3600,
  extractionUsdPerWorkspacePerDay: 5,
  workspaceKeyRetentionDays: 30,
};

export interface TestObservability {
  limits: RuntimeLimits;
  metrics: MetricsRegistry;
  logger: Logger;
}

export function testObservability(
  overrides: { limits?: Partial<RuntimeLimits>; write?: (line: string) => void } = {},
): TestObservability {
  return {
    limits: { ...TEST_LIMITS, ...overrides.limits },
    metrics: createMetrics(),
    logger: createLogger({
      service: "test",
      write:
        overrides.write ??
        (() => {
          // Silent by default: a test run should not print a line per job.
        }),
    }),
  };
}
