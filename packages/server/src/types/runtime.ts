import type { HandoffDatabase } from "@handoff/db";
import type { DataKeyService } from "../security/encryption/data-keys";
import type { ExtractionProvider } from "../ai/extract-events";
import type { ObjectStorage } from "../storage/object-storage";
import type { TranscriptionProvider } from "../transcription/provider";
import type { ClerkGateway } from "./clerk";
import type { KeyWrapper } from "./encryption";
import type { Logger, MetricsRegistry } from "./observability";

/**
 * Configured ceilings the services enforce. They come from validated configuration, so no service
 * reads the environment and a test can run against its own numbers.
 */
export interface RuntimeLimits {
  /** Captures one author may create in one workspace on one UTC day. */
  capturesPerUserPerDay: number;
  audioSecondsPerWorkspacePerDay: number;
  /** Estimated provider spend, priced with lib/provider-rates.ts. */
  extractionUsdPerWorkspacePerDay: number;
  /** How long a deleted workspace's scope keys stay decrypt-only before they may be retired. */
  workspaceKeyRetentionDays: number;
}

/** Process-lifetime collaborators built once from validated configuration. */
export interface ServerRuntime {
  db: HandoffDatabase;
  keys: DataKeyService;
  keyWrapper: KeyWrapper;
  clerk: ClerkGateway;
  guardianRoleKey: string;
  invitationRedirectUrl: string;
  /** Null when storage is not configured, so health checks and manual entry still work. */
  storage: ObjectStorage | null;
  /** The queue credential's own pool. Null when DATABASE_JOB_DISPATCH_URL is not set. */
  jobsDb: HandoffDatabase | null;
  limits: RuntimeLimits;
  /** Process-wide counters. Snapshots are dumped on an interval; there is no metrics backend. */
  metrics: MetricsRegistry;
  logger: Logger;
  now: () => Date;
  close: () => Promise<void>;
}

/** What a service needs for one request. Services receive this explicitly; nothing is global. */
export interface ServiceDeps {
  db: HandoffDatabase;
  keys: DataKeyService;
  keyWrapper: KeyWrapper;
  clerk: ClerkGateway;
  guardianRoleKey: string;
  invitationRedirectUrl: string;
  storage: ObjectStorage | null;
  /**
   * The queue credential. Reading a job is a tenant read the API role already has; changing one
   * is not, so requeueing a failed capture runs here (packages/db/migrations/README.md).
   */
  jobsDb: HandoffDatabase | null;
  limits: RuntimeLimits;
  metrics: MetricsRegistry;
  logger: Logger;
  requestId: string;
  now: () => Date;
}

/**
 * The worker requires everything the API may run without: it cannot read audio, transcribe, or
 * extract otherwise, and it claims jobs on the dispatcher credential rather than the API one.
 */
export interface WorkerRuntime extends ServerRuntime {
  storage: ObjectStorage;
  jobsDb: HandoffDatabase;
  transcription: TranscriptionProvider;
  extraction: ExtractionProvider;
}
