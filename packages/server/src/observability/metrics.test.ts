import { describe, expect, it } from "vitest";
import { estimateProviderSpendUsd } from "../lib/provider-rates";
import {
  AUDIO_SECONDS_COUNTER,
  TOKENS_IN_COUNTER,
  TOKENS_OUT_COUNTER,
  createMetrics,
  formatSnapshotLine,
} from "./metrics";

describe("createMetrics", () => {
  it("accumulates counters per label set", () => {
    const metrics = createMetrics();
    metrics.incrementCounter("jobs", { jobKind: "process_capture", status: "completed" });
    metrics.incrementCounter("jobs", { jobKind: "process_capture", status: "completed" });
    metrics.incrementCounter("jobs", { jobKind: "process_capture", status: "failed" });

    const counters = metrics.snapshot().counters;
    expect(counters).toContainEqual({
      name: "jobs",
      labels: { jobKind: "process_capture", status: "completed" },
      value: 2,
    });
    expect(counters).toContainEqual({
      name: "jobs",
      labels: { jobKind: "process_capture", status: "failed" },
      value: 1,
    });
  });

  it("summarizes durations as count, total, and worst case", () => {
    const metrics = createMetrics();
    metrics.observeDuration("job_duration_ms", 100, { jobKind: "validate_media" });
    metrics.observeDuration("job_duration_ms", 300, { jobKind: "validate_media" });

    expect(metrics.snapshot().durations).toEqual([
      {
        name: "job_duration_ms",
        labels: { jobKind: "validate_media" },
        count: 2,
        totalMs: 400,
        maxMs: 300,
      },
    ]);
  });

  it("reports the oldest queue age seen in the window, not the last one", () => {
    const metrics = createMetrics();
    metrics.recordQueueAge(4);
    metrics.recordQueueAge(920);
    metrics.recordQueueAge(11);
    expect(metrics.snapshot().queueOldestAgeSeconds).toBe(920);

    // The alert is per window: a drained queue must not keep reporting yesterday's stall.
    metrics.reset();
    expect(metrics.snapshot().queueOldestAgeSeconds).toBe(0);
  });

  it("prices token and audio counters with the shared provider rates", () => {
    const metrics = createMetrics();
    metrics.incrementCounter(TOKENS_IN_COUNTER, { workspaceId: "one" }, 200_000);
    metrics.incrementCounter(TOKENS_OUT_COUNTER, { workspaceId: "one" }, 20_000);
    metrics.incrementCounter(AUDIO_SECONDS_COUNTER, { workspaceId: "two" }, 60);

    expect(metrics.snapshot().providerSpendEstimateUsd).toBeCloseTo(
      estimateProviderSpendUsd({ tokensIn: 200_000, tokensOut: 20_000, audioSeconds: 60 }),
      10,
    );
  });

  it("keeps gauge levels across a reset and clears counted work", () => {
    const metrics = createMetrics();
    metrics.setGauge("storage_reserved_bytes", 4096, { workspaceId: "one" });
    metrics.incrementCounter("api_requests", { operation: "children.get", status: "200" });
    metrics.reset();

    const snapshot = metrics.snapshot();
    expect(snapshot.counters).toEqual([]);
    expect(snapshot.gauges).toEqual([
      { name: "storage_reserved_bytes", labels: { workspaceId: "one" }, value: 4096 },
    ]);
  });

  it("formats one snapshot line that carries numbers and opaque labels only", () => {
    const metrics = createMetrics();
    metrics.incrementCounter("api_requests", { operation: "children.get", status: "200" });
    const at = new Date("2026-09-06T12:00:00.000Z");
    const parsed = JSON.parse(formatSnapshotLine("api", metrics.snapshot(), at)) as {
      event: string;
      service: string;
      time: string;
      snapshot: { counters: { name: string }[] };
    };
    expect(parsed).toMatchObject({
      event: "metrics_snapshot",
      service: "api",
      time: at.toISOString(),
    });
    expect(parsed.snapshot.counters[0]?.name).toBe("api_requests");
  });
});
