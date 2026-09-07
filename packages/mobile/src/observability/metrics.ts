// Opt-in client counters for the pilot observer. Nothing here leaves the device.
//
// architecture.md section 9 allows telemetry to hold metrics and opaque ids only. The safest way
// to honour that in a prototype is to carry no ids at all: a sample is a name from a fixed list,
// a timestamp, an optional duration, and an optional ok/failed label. There is no free-text field
// to put a child's name, a transcript, or a signed URL into.
//
// Server-side ingestion is deliberately deferred. No `POST /v1/client-metrics` endpoint exists in
// the data contract, and adding one would mean designing retention, authorization, and a purge
// path for a second store during pilot hardening. The pilot observer reads the buffer from the
// Diagnostics section of the privacy settings screen instead; `scripts/measure-pilot.ts` computes
// the product metrics from the database, which is the authoritative source anyway.
import { CLIENT_METRIC_NAMES } from "./types/metrics";
import type {
  ClientMetricFields,
  ClientMetricName,
  ClientMetricSample,
  ClientMetricsSnapshot,
} from "./types/metrics";

/** Enough to cover a session of observed use without growing without bound. */
const MAX_SAMPLES = 200;

const allowedNames = new Set<string>(CLIENT_METRIC_NAMES);

// Module state, not a store: this is diagnostic scaffolding, not application state, and it must
// not cause a re-render on every counter.
let isEnabled = false;
let samples: ClientMetricSample[] = [];
let counts = new Map<ClientMetricName, number>();
let droppedSampleCount = 0;
let revision = 0;

const listeners = new Set<() => void>();

function notify(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

/** Off until the caregiver turns it on, and off again for the next session. Never persisted. */
export function setClientMetricsEnabled(enabled: boolean): void {
  if (isEnabled === enabled) return;
  isEnabled = enabled;
  if (!enabled) resetBuffer();
  notify();
}

export function areClientMetricsEnabled(): boolean {
  return isEnabled;
}

/**
 * Records one counter. Unknown names and unusable durations are dropped rather than stored, so a
 * caller cannot smuggle a value in through a field the reader later prints.
 */
export function recordClientMetric(name: string, fields: ClientMetricFields = {}): void {
  if (!isEnabled) return;
  if (!allowedNames.has(name)) return;
  const metricName = name as ClientMetricName;

  const durationMs =
    fields.durationMs !== undefined && Number.isFinite(fields.durationMs) && fields.durationMs >= 0
      ? Math.round(fields.durationMs)
      : null;

  samples.push({
    name: metricName,
    at: Date.now(),
    durationMs,
    status: fields.status ?? null,
  });
  if (samples.length > MAX_SAMPLES) {
    samples = samples.slice(samples.length - MAX_SAMPLES);
    droppedSampleCount += 1;
  }
  counts.set(metricName, (counts.get(metricName) ?? 0) + 1);
  notify();
}

export function readClientMetrics(): ClientMetricsSnapshot {
  return {
    isEnabled,
    counts: Object.fromEntries(counts),
    samples: [...samples],
    droppedSampleCount,
  };
}

/** Called on sign-out as well as from the settings screen: one account's counts are not another's. */
export function clearClientMetrics(): void {
  resetBuffer();
  notify();
}

/** Lets a screen subscribe without polling; the number changes whenever the buffer changes. */
export function subscribeToClientMetrics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clientMetricsRevision(): number {
  return revision;
}

function resetBuffer(): void {
  samples = [];
  counts = new Map();
  droppedSampleCount = 0;
}
