import { useSyncExternalStore } from "react";

import { clientMetricsRevision, readClientMetrics, subscribeToClientMetrics } from "./metrics";
import type { ClientMetricsSnapshot } from "./types/metrics";

// useSyncExternalStore compares by reference, so the revision counter is the snapshot identity and
// readClientMetrics is only called when something actually changed.
let cached: ClientMetricsSnapshot = readClientMetrics();
let cachedRevision = -1;

function getSnapshot(): ClientMetricsSnapshot {
  const current = clientMetricsRevision();
  if (current !== cachedRevision) {
    cachedRevision = current;
    cached = readClientMetrics();
  }
  return cached;
}

/** Reads the local counter buffer for the settings screen's Diagnostics section. */
export function useClientMetrics(): ClientMetricsSnapshot {
  return useSyncExternalStore(subscribeToClientMetrics, getSnapshot, getSnapshot);
}
