// Structured logs with a closed field list. Architecture §9: telemetry keeps request/job ids,
// durations, statuses, counts, token counts, and audio seconds, and never a name, a birthdate, a
// transcript, a signed URL, or a token. The allowlist is the enforcement, not a review habit: a
// field nobody approved is dropped and only its count is reported.
import type { LogFields, LogLevel, Logger, LoggerOptions } from "../types/observability";

/**
 * Every field name a log line may carry. Identifiers are opaque; a name that could hold free text,
 * a URL, or a payload is deliberately absent and cannot be added by a call site.
 */
const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  "requestId",
  "jobId",
  "jobKind",
  "stage",
  "workspaceId",
  "childId",
  "captureId",
  "assetId",
  "userId",
  "durationMs",
  "status",
  "errorCode",
  "count",
  "bytes",
  "tokens",
  "audioSeconds",
]);

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keeps the approved fields and reports how many were refused, without naming them. */
function filterFields(fields: LogFields): LogFields {
  const kept: LogFields = {};
  let dropped = 0;
  for (const [name, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(name)) {
      dropped += 1;
      continue;
    }
    kept[name] = value;
  }
  if (dropped > 0) kept.dropped_fields = dropped;
  return kept;
}

export function createLogger({
  service,
  level = "info",
  now = () => new Date(),
  write = (line) => {
    console.info(line);
  },
}: LoggerOptions): Logger {
  const threshold = LEVEL_ORDER[level];

  function emit(entry: LogLevel, event: string, fields: LogFields): void {
    if (LEVEL_ORDER[entry] < threshold) return;
    write(
      JSON.stringify({
        time: now().toISOString(),
        level: entry,
        service,
        event,
        ...filterFields(fields),
      }),
    );
  }

  return {
    info: (event, fields = {}) => {
      emit("info", event, fields);
    },
    warn: (event, fields = {}) => {
      emit("warn", event, fields);
    },
    error: (event, fields = {}) => {
      emit("error", event, fields);
    },
  };
}

/** Exported for the test that proves an unapproved field never reaches a line. */
export function isAllowedLogField(name: string): boolean {
  return ALLOWED_FIELDS.has(name);
}
