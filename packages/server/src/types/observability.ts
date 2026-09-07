// Authored types for the logging and metrics surface. See docs/runbook.md for the thresholds an
// operator reads these against.

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Only scalars. A nested object could smuggle an unapproved field past the name allowlist. */
export type LogFields = Record<string, string | number | boolean | null>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  now?: () => Date;
  /** Where a finished line goes. Tests collect it; the processes write it to standard output. */
  write?: (line: string) => void;
}

/** Label values are opaque identifiers and closed codes, never names or free text. */
export type MetricLabels = Record<string, string>;

export interface CounterSample {
  name: string;
  labels: MetricLabels;
  value: number;
}

export interface DurationSample {
  name: string;
  labels: MetricLabels;
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface GaugeSample {
  name: string;
  labels: MetricLabels;
  value: number;
}

export interface MetricsSnapshot {
  /** Milliseconds since the registry was created or last reset. */
  windowMs: number;
  counters: CounterSample[];
  durations: DurationSample[];
  gauges: GaugeSample[];
  /** Age of the oldest job at the last claim. The stalled-queue alert reads this. */
  queueOldestAgeSeconds: number;
  /** Tokens and audio seconds priced with lib/provider-rates.ts. An estimate, not an invoice. */
  providerSpendEstimateUsd: number;
}

export interface MetricsRegistry {
  incrementCounter(name: string, labels?: MetricLabels, by?: number): void;
  observeDuration(name: string, ms: number, labels?: MetricLabels): void;
  /** Last value wins; used for levels such as reserved bytes rather than accumulating totals. */
  setGauge(name: string, value: number, labels?: MetricLabels): void;
  /** Records the age of a claimed job, keeping the largest seen in this window. */
  recordQueueAge(seconds: number): void;
  snapshot(): MetricsSnapshot;
  /** Clears counters, durations, and the queue-age high-water mark. Gauges keep their level. */
  reset(): void;
}
