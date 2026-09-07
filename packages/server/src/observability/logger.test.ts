import { describe, expect, it } from "vitest";
import { createLogger, isAllowedLogField } from "./logger";

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

function parse(line: string | undefined): Record<string, unknown> {
  if (line === undefined) throw new Error("expected a log line");
  return JSON.parse(line) as Record<string, unknown>;
}

describe("createLogger", () => {
  it("keeps approved fields and drops everything else by name", () => {
    const sink = collect();
    const logger = createLogger({ service: "worker", write: sink.write });

    logger.info("job", {
      jobId: "3f1b",
      durationMs: 12,
      // None of these are approved. A transcript is the reason the allowlist exists at all.
      transcript: "she ate 120 ml at 9",
      childName: "Rowan",
      signedUrl: "https://storage.test/read/abc",
    });

    const entry = parse(sink.lines[0]);
    expect(entry.event).toBe("job");
    expect(entry.jobId).toBe("3f1b");
    expect(entry.durationMs).toBe(12);
    expect(entry.dropped_fields).toBe(3);
    expect(sink.lines[0]).not.toContain("Rowan");
    expect(sink.lines[0]).not.toContain("120 ml");
    expect(sink.lines[0]).not.toContain("storage.test");
  });

  it("omits the dropped count when every field was approved", () => {
    const sink = collect();
    createLogger({ service: "api", write: sink.write }).warn("request_slow", { durationMs: 900 });
    expect(parse(sink.lines[0])).not.toHaveProperty("dropped_fields");
  });

  it("writes the level, service, and an ISO timestamp on every line", () => {
    const sink = collect();
    const at = new Date("2026-09-06T12:00:00.000Z");
    createLogger({ service: "api", write: sink.write, now: () => at }).error("request_failed", {
      requestId: "abc",
      status: 500,
    });
    expect(parse(sink.lines[0])).toMatchObject({
      time: at.toISOString(),
      level: "error",
      service: "api",
      event: "request_failed",
      status: 500,
    });
  });

  it("suppresses lines below the configured level", () => {
    const sink = collect();
    const logger = createLogger({ service: "worker", level: "warn", write: sink.write });
    logger.info("job", { jobId: "one" });
    logger.error("job_runner_error", { errorCode: "TypeError" });
    expect(sink.lines).toHaveLength(1);
    expect(parse(sink.lines[0]).event).toBe("job_runner_error");
  });

  it("refuses field names that could carry free text or a location", () => {
    expect(isAllowedLogField("workspaceId")).toBe(true);
    expect(isAllowedLogField("audioSeconds")).toBe(true);
    expect(isAllowedLogField("transcript")).toBe(false);
    expect(isAllowedLogField("objectKey")).toBe(false);
    expect(isAllowedLogField("email")).toBe(false);
  });
});
