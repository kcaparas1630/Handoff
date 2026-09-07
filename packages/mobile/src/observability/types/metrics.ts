/**
 * The complete set of client counters. A name that is not in this list is dropped, so a future
 * screen cannot start recording something that was never reviewed (architecture.md section 9).
 */
export const CLIENT_METRIC_NAMES = [
  "capture_saved_locally",
  "capture_uploaded",
  "capture_review_ready",
  "manual_entry_saved",
  "brief_opened",
  "brief_acknowledged",
  "attachment_uploaded",
  "app_foreground",
] as const;

export type ClientMetricName = (typeof CLIENT_METRIC_NAMES)[number];

/** Closed set: an outcome label can never carry an error message or a provider response. */
export type ClientMetricStatus = "ok" | "failed";

export type ClientMetricFields = {
  /** Whole milliseconds. Negative or non-finite values are discarded, not clamped to zero. */
  durationMs?: number;
  status?: ClientMetricStatus;
};

export type ClientMetricSample = {
  name: ClientMetricName;
  /** Milliseconds since the epoch, from the device clock. No child, capture, or user id. */
  at: number;
  durationMs: number | null;
  status: ClientMetricStatus | null;
};

export type ClientMetricsSnapshot = {
  isEnabled: boolean;
  /** Counts since the buffer was last cleared, one entry per recorded name. */
  counts: Readonly<Partial<Record<ClientMetricName, number>>>;
  /** Most recent samples, oldest first, bounded by the ring buffer size. */
  samples: readonly ClientMetricSample[];
  /** Samples the ring buffer has already discarded, so a reader knows the window is partial. */
  droppedSampleCount: number;
};
