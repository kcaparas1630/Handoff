// One process-lifetime runtime for every API route. It is built on first use so that
// `expo export` can bundle these routes without any server configuration present.
import {
  createHandler,
  createServerRuntime,
  loadServerEnv,
  startMetricsDump,
} from "@handoff/server";
import type { ServerEnv, ServerRuntime } from "@handoff/server";

type Handler = ReturnType<typeof createHandler>;

let env: ServerEnv | null = null;
let runtime: ServerRuntime | null = null;
let handler: Handler | null = null;

/** Validated configuration. Never log or return any value it holds. */
export function getServerEnv(): ServerEnv {
  env ??= loadServerEnv(process.env);
  return env;
}

export function getRuntime(): ServerRuntime {
  if (runtime === null) {
    const env = getServerEnv();
    runtime = createServerRuntime(env);
    // There is no metrics backend in the pilot: the snapshot is a JSON line the runbook reads.
    // The timer is unref'd, so it never keeps a finished process alive.
    startMetricsDump({
      metrics: runtime.metrics,
      service: "api",
      intervalSeconds: env.metricsFlushSeconds,
    });
  }
  return runtime;
}

export function getHandler(): Handler {
  handler ??= createHandler({ runtime: getRuntime() });
  return handler;
}

/**
 * Test-only. Integration tests build a runtime against a disposable database and a fake Clerk
 * gateway, then call the exported route functions directly. It fails closed in production so a
 * misconfigured deployment can never serve requests from an injected runtime.
 */
export function overrideRuntimeForTests(next: ServerRuntime): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("overrideRuntimeForTests is not available in production");
  }
  runtime = next;
  handler = createHandler({ runtime: next });
}
