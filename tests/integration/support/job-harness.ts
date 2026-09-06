// The worker side of the test harness: the dispatcher credential, the three provider fakes, and a
// runner the tests drive one claim at a time. It reuses the service harness's database and keys,
// so a capture created through the API services is the same row the worker then processes.
import { createDbClient } from "../../../packages/db/src/client";
import { createJobRunner } from "../../../packages/server/src/jobs/runner";
import { cleanupAudio } from "../../../packages/server/src/jobs/cleanup-audio";
import { processCapture } from "../../../packages/server/src/jobs/process-capture";
import { reconcileClerk } from "../../../packages/server/src/jobs/reconcile-clerk";
import { createFakeExtraction } from "./fake-extraction";
import { createFakeObjectStorage } from "./fake-object-storage";
import { createFakeTranscription } from "./fake-transcription";
import type { DbClient } from "../../../packages/db/src/client";
import type { JobRunner } from "../../../packages/server/src/types/jobs";
import type { WorkerRuntime } from "../../../packages/server/src/types/runtime";
import type { FakeExtraction } from "./fake-extraction";
import type { FakeObjectStorage } from "./fake-object-storage";
import type { FakeTranscription } from "./fake-transcription";
import type { TestHarness } from "./service-harness";

export interface JobHarness {
  runtime: WorkerRuntime;
  runner: JobRunner;
  storage: FakeObjectStorage;
  transcription: FakeTranscription;
  extraction: FakeExtraction;
  /** The queue credential, for asserting on job rows the way the worker sees them. */
  dispatcher: DbClient;
  close: () => Promise<void>;
}

export interface JobHarnessOptions {
  concurrency?: number;
  leaseMs?: number;
}

/**
 * Also wires the storage and queue handles into the harness's service deps, because the API side
 * of this milestone signs uploads and requeues failed captures with exactly those two.
 */
export function createJobHarness(
  harness: TestHarness,
  options: JobHarnessOptions = {},
): JobHarness {
  const dispatcher = createDbClient({ url: harness.database.dispatcherUrl, maxConnections: 5 });
  const storage = createFakeObjectStorage();
  const transcription = createFakeTranscription();
  const extraction = createFakeExtraction();

  harness.deps.storage = storage;
  harness.deps.jobsDb = dispatcher.db;

  const runtime: WorkerRuntime = {
    db: harness.deps.db,
    keys: harness.deps.keys,
    keyWrapper: harness.deps.keyWrapper,
    clerk: harness.deps.clerk,
    guardianRoleKey: harness.deps.guardianRoleKey,
    invitationRedirectUrl: harness.deps.invitationRedirectUrl,
    storage,
    jobsDb: dispatcher.db,
    transcription,
    extraction,
    now: harness.deps.now,
    close: () => dispatcher.close(),
  };

  const runner = createJobRunner({
    runtime,
    handlers: {
      process_capture: processCapture,
      reconcile_clerk: reconcileClerk,
      cleanup_audio: cleanupAudio,
    },
    concurrency: options.concurrency ?? 2,
    leaseMs: options.leaseMs ?? 30_000,
  });

  return {
    runtime,
    runner,
    storage,
    transcription,
    extraction,
    dispatcher,
    close: () => dispatcher.close(),
  };
}
