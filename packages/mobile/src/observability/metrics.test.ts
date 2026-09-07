import { beforeEach, describe, expect, it } from "vitest";

import {
  areClientMetricsEnabled,
  clearClientMetrics,
  readClientMetrics,
  recordClientMetric,
  setClientMetricsEnabled,
} from "./metrics";

beforeEach(() => {
  setClientMetricsEnabled(false);
  clearClientMetrics();
});

describe("client metrics", () => {
  it("records nothing until the caregiver opts in", () => {
    recordClientMetric("capture_saved_locally");
    expect(areClientMetricsEnabled()).toBe(false);
    expect(readClientMetrics().samples).toHaveLength(0);

    setClientMetricsEnabled(true);
    recordClientMetric("capture_saved_locally");
    expect(readClientMetrics().counts.capture_saved_locally).toBe(1);
  });

  it("drops a name that is not on the allowlist", () => {
    setClientMetricsEnabled(true);
    recordClientMetric("child_name_viewed");
    expect(readClientMetrics().samples).toHaveLength(0);
  });

  it("keeps only the closed set of fields", () => {
    setClientMetricsEnabled(true);
    recordClientMetric("capture_uploaded", { durationMs: 1234.6, status: "ok" });
    const [sample] = readClientMetrics().samples;
    expect(sample).toMatchObject({ name: "capture_uploaded", durationMs: 1235, status: "ok" });
    expect(Object.keys(sample ?? {}).sort()).toEqual(["at", "durationMs", "name", "status"]);
  });

  it("discards an unusable duration instead of storing zero", () => {
    setClientMetricsEnabled(true);
    recordClientMetric("brief_opened", { durationMs: Number.NaN });
    recordClientMetric("brief_opened", { durationMs: -5 });
    expect(readClientMetrics().samples.map((sample) => sample.durationMs)).toEqual([null, null]);
  });

  it("turning telemetry off clears what was already collected", () => {
    setClientMetricsEnabled(true);
    recordClientMetric("app_foreground");
    setClientMetricsEnabled(false);
    expect(readClientMetrics().counts).toEqual({});
  });
});
