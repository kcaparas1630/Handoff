import {
  CLIENT_METRIC_NAMES,
  clearClientMetrics,
  setClientMetricsEnabled,
  useClientMetrics,
} from "@handoff/mobile";
import { Button, StatusMessage } from "@handoff/ui";
import { Text, View } from "react-native";

/**
 * The pilot observer's counter view. It is opt-in, in memory only, and reads a fixed set of
 * counters: there is no field that could hold a name, a transcript, or a URL. Nothing is sent
 * anywhere; see packages/mobile/src/observability/metrics.ts for why ingestion is deferred.
 */
/** The last few durations from the ring buffer; enough to spot a slow upload, not a session log. */
const RECENT_TIMINGS = 5;

export function DiagnosticsSection() {
  const metrics = useClientMetrics();
  const timed = metrics.samples
    .filter((sample) => sample.durationMs !== null)
    .slice(-RECENT_TIMINGS)
    .reverse();

  return (
    <View className="gap-md" testID="diagnostics-section">
      <StatusMessage
        tone="info"
        message={
          metrics.isEnabled
            ? "Counting is on for this session only. Counts stay on this phone and are cleared when you turn it off or sign out."
            : "Counting is off. Turning it on records how often things happen — never what was said, who it was about, or any file."
        }
      />

      <Button
        label={metrics.isEnabled ? "Stop counting" : "Count what I do in this session"}
        variant="secondary"
        onPress={() => setClientMetricsEnabled(!metrics.isEnabled)}
        testID="diagnostics-toggle"
      />

      {metrics.isEnabled ? (
        <>
          {CLIENT_METRIC_NAMES.map((name) => (
            <View key={name} className="flex-row items-center justify-between gap-md">
              <Text className="flex-1 text-sm text-primary dark:text-primary-dark">{name}</Text>
              <Text className="text-sm font-semibold text-primary dark:text-primary-dark">
                {String(metrics.counts[name] ?? 0)}
              </Text>
            </View>
          ))}

          {metrics.droppedSampleCount === 0 ? null : (
            <Text className="text-sm text-muted dark:text-muted-dark">
              {String(metrics.droppedSampleCount)} older entries have already been dropped, so the
              timings below cover only the most recent activity.
            </Text>
          )}

          {timed.length === 0 ? null : (
            <>
              <Text className="text-sm font-semibold text-primary dark:text-primary-dark">
                Most recent timings
              </Text>
              {timed.map((sample) => (
                <View
                  key={`${sample.name}-${String(sample.at)}`}
                  className="flex-row items-center justify-between gap-md"
                >
                  <Text className="flex-1 text-sm text-muted dark:text-muted-dark">
                    {sample.name}
                    {sample.status === null ? "" : ` · ${sample.status}`}
                  </Text>
                  <Text className="text-sm text-muted dark:text-muted-dark">
                    {String(sample.durationMs)} ms
                  </Text>
                </View>
              ))}
            </>
          )}

          <Button
            label="Clear these counts"
            variant="quiet"
            onPress={clearClientMetrics}
            testID="diagnostics-clear"
          />
        </>
      ) : null}
    </View>
  );
}
