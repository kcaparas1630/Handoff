// In-process counters, duration summaries, and gauges. There is no metrics backend in the pilot,
// so the processes dump a snapshot as one JSON line on an interval and `GET /v1/internal/metrics`
// returns the same shape for a probe.
//
// Names and label values are opaque identifiers and closed codes only: a workspace id is a label,
// a workspace name never is. The dump writes its own line rather than going through the logger's
// field allowlist, because a snapshot is a series list; what makes it safe is that every value in
// it is a number and every label is an opaque id.
import { estimateProviderSpendUsd } from "../lib/provider-rates";
import type {
  CounterSample,
  DurationSample,
  GaugeSample,
  MetricLabels,
  MetricsRegistry,
  MetricsSnapshot,
} from "../types/observability";

/** Counters the spend estimate is derived from, so the two readings cannot drift apart. */
export const TOKENS_IN_COUNTER = "provider_tokens_in";
export const TOKENS_OUT_COUNTER = "provider_tokens_out";
export const AUDIO_SECONDS_COUNTER = "provider_audio_seconds";

interface DurationTotals {
  count: number;
  totalMs: number;
  maxMs: number;
}

/** Sorted so the same label set always produces the same series key. */
function seriesKey(name: string, labels: MetricLabels): string {
  const parts = Object.keys(labels)
    .sort()
    .map((label) => `${label}=${labels[label] ?? ""}`);
  return parts.length === 0 ? name : `${name}|${parts.join(",")}`;
}

function parseKey(key: string): { name: string; labels: MetricLabels } {
  const separator = key.indexOf("|");
  if (separator === -1) return { name: key, labels: {} };
  const labels: MetricLabels = {};
  for (const part of key.slice(separator + 1).split(",")) {
    const equals = part.indexOf("=");
    if (equals === -1) continue;
    labels[part.slice(0, equals)] = part.slice(equals + 1);
  }
  return { name: key.slice(0, separator), labels };
}

export function createMetrics(now: () => number = Date.now): MetricsRegistry {
  const counters = new Map<string, number>();
  const durations = new Map<string, DurationTotals>();
  const gauges = new Map<string, number>();
  let windowStart = now();
  let queueOldestAgeSeconds = 0;

  function sumCounter(name: string): number {
    let total = 0;
    for (const [key, value] of counters) {
      if (parseKey(key).name === name) total += value;
    }
    return total;
  }

  return {
    incrementCounter(name, labels = {}, by = 1) {
      const key = seriesKey(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + by);
    },

    observeDuration(name, ms, labels = {}) {
      const key = seriesKey(name, labels);
      const totals = durations.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
      durations.set(key, {
        count: totals.count + 1,
        totalMs: totals.totalMs + ms,
        maxMs: Math.max(totals.maxMs, ms),
      });
    },

    setGauge(name, value, labels = {}) {
      gauges.set(seriesKey(name, labels), value);
    },

    recordQueueAge(seconds) {
      queueOldestAgeSeconds = Math.max(queueOldestAgeSeconds, seconds);
    },

    snapshot() {
      const counterSamples: CounterSample[] = [...counters].map(([key, value]) => ({
        ...parseKey(key),
        value,
      }));
      const durationSamples: DurationSample[] = [...durations].map(([key, totals]) => ({
        ...parseKey(key),
        ...totals,
      }));
      const gaugeSamples: GaugeSample[] = [...gauges].map(([key, value]) => ({
        ...parseKey(key),
        value,
      }));
      return {
        windowMs: now() - windowStart,
        counters: counterSamples,
        durations: durationSamples,
        gauges: gaugeSamples,
        queueOldestAgeSeconds,
        providerSpendEstimateUsd: estimateProviderSpendUsd({
          tokensIn: sumCounter(TOKENS_IN_COUNTER),
          tokensOut: sumCounter(TOKENS_OUT_COUNTER),
          audioSeconds: sumCounter(AUDIO_SECONDS_COUNTER),
        }),
      };
    },

    reset() {
      counters.clear();
      durations.clear();
      queueOldestAgeSeconds = 0;
      windowStart = now();
    },
  };
}

/**
 * Publishes a workspace's storage levels as gauges. Called wherever the counters actually move, so
 * the reading is a by-product of the write rather than an extra query. The label is the workspace
 * id, which is opaque; the numbers are bytes.
 */
export function recordStorageLevels(
  metrics: MetricsRegistry,
  levels: { workspaceId: string; reservedBytes: number; usedBytes: number } | null,
): void {
  if (levels === null) return;
  const labels = { workspaceId: levels.workspaceId };
  metrics.setGauge("storage_reserved_bytes", levels.reservedBytes, labels);
  metrics.setGauge("storage_used_bytes", levels.usedBytes, labels);
}

/**
 * The periodic dump. It writes its own line rather than going through the logger, because a
 * snapshot is a series list, not a set of approved field names; what makes it safe is that every
 * value in it is a number and every label is an opaque id or a closed code.
 */
export function formatSnapshotLine(
  service: string,
  snapshot: MetricsSnapshot,
  at: Date = new Date(),
): string {
  return JSON.stringify({
    time: at.toISOString(),
    level: "info",
    service,
    event: "metrics_snapshot",
    snapshot,
  });
}

/**
 * Writes one snapshot line per interval and starts the next window. Returns the stop function,
 * which a process must call while shutting down: an interval keeps an event loop alive, and the
 * timer handle is typed differently under Node and DOM libraries, so it is not unref'd here.
 */
export function startMetricsDump({
  metrics,
  service,
  intervalSeconds,
  now = () => new Date(),
  write = (line) => {
    console.info(line);
  },
}: {
  metrics: MetricsRegistry;
  service: string;
  intervalSeconds: number;
  now?: () => Date;
  write?: (line: string) => void;
}): () => void {
  const timer = setInterval(() => {
    write(formatSnapshotLine(service, metrics.snapshot(), now()));
    metrics.reset();
  }, intervalSeconds * 1000);
  return () => {
    clearInterval(timer);
  };
}
