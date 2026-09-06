// The background worker process. It validates its configuration, builds every provider from that
// configuration, and then does nothing but claim leased jobs. It serves no HTTP traffic.
import {
  cleanupAudio,
  cleanupUploads,
  createJobRunner,
  createWorkerRuntime,
  loadServerEnv,
  processCapture,
  reconcileClerk,
  requireWorkerEnv,
  scheduleReconciliation,
  ServerEnvError,
  validateMedia,
} from "@handoff/server";

const EXIT_CONFIGURATION = 78;
const EXIT_FAILURE = 1;

async function main(): Promise<void> {
  const env = loadServerEnv(process.env);
  requireWorkerEnv(env);
  const runtime = createWorkerRuntime(env);

  const runner = createJobRunner({
    runtime,
    handlers: {
      process_capture: processCapture,
      validate_media: validateMedia,
      reconcile_clerk: reconcileClerk,
      cleanup_audio: cleanupAudio,
      cleanup_uploads: cleanupUploads,
    },
    concurrency: env.workerConcurrency,
    leaseMs: env.workerLeaseSeconds * 1000,
  });

  // Pending provider reconciliations are scheduled once at startup; each becomes its own job.
  const scheduled = await scheduleReconciliation({ db: runtime.db, jobsDb: runtime.jobsDb });
  console.info(
    JSON.stringify({
      event: "worker_started",
      concurrency: env.workerConcurrency,
      leaseSeconds: env.workerLeaseSeconds,
      reconciliationsScheduled: scheduled,
    }),
  );

  runner.start();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(JSON.stringify({ event: "worker_stopping", signal }));
    // In-flight handlers finish first: a job abandoned mid-write would wait out its lease.
    void runner
      .stop()
      .then(() => runtime.close())
      .then(() => process.exit(0))
      .catch(() => process.exit(EXIT_FAILURE));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  // Configuration errors name the missing variables and never their values.
  if (error instanceof ServerEnvError) {
    console.error(`worker configuration is incomplete: ${error.variables.join(", ")}`);
    process.exit(EXIT_CONFIGURATION);
  }
  console.error(`worker failed to start: ${error instanceof Error ? error.name : "UnknownError"}`);
  process.exit(EXIT_FAILURE);
});
