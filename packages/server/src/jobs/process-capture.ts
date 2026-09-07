// Recording to reviewable draft. Two stages with a checkpoint between them, so a crash after
// transcription never pays for transcription twice, and no stage holds a transaction open across
// a provider call (architecture §4).
import { randomUUID } from "node:crypto";
import { AUDIO_MAX_BYTES } from "@handoff/contracts";
import {
  capturesRepository,
  mediaRepository,
  storageQuotaRepository,
  withTenantTransaction,
} from "@handoff/db";
import { canCreateCapture } from "@handoff/domain";
import type { CaptureDraft } from "@handoff/contracts";
import type { CaptureRow, CaptureStatus, HandoffDatabase, MediaAssetRow } from "@handoff/db";
import { validateExtractionSemantics } from "../ai/lib/validate-extraction";
import { PROMPT_VERSION } from "../ai/prompts/extract-events-v1";
import { authorizeChild } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { accessContextOf } from "../lib/access-context";
import { ProviderError } from "../lib/provider-error";
import { EncryptionError } from "../security/encryption/errors";
import { decryptCaptureDraft, encryptCaptureDraft } from "../security/journal-fields";
import { decryptChildProfile } from "../security/profile-fields";
import { recordStorageLevels } from "../observability/metrics";
import { findAudioAsset } from "../services/capture-uploads";
import {
  assertExtractionBudget,
  BudgetExceededError,
  recordProviderUsage,
} from "../services/quotas";
import { buildDraftCandidates } from "./lib/draft-candidates";
import type { DataKeyService } from "../security/encryption/data-keys";
import type { JobContext, JobHandler, JobOutcome } from "../types/jobs";
import type { WorkerRuntime } from "../types/runtime";

const DRAFT_SCHEMA_VERSION = 1;

/** The only checkpoint this job records. Stage markers only, never transcript text. */
const TRANSCRIBED_CHECKPOINT = { stage: "transcribed" };

/**
 * Statuses this job may still act on. `failed` is included because a caregiver's retry requeues
 * the job before it clears the capture, so a claim can legitimately arrive first.
 */
const PROCESSABLE: readonly CaptureStatus[] = ["queued", "processing", "failed"];

interface CaptureIds {
  workspaceId: string;
  childId: string;
  captureId: string;
}

interface CaptureWork {
  ids: CaptureIds;
  capture: CaptureRow;
  asset: MediaAssetRow | null;
  draft: CaptureDraft;
  /** The child's first name, which is the only identity detail the extractor ever receives. */
  childAlias: string;
}

type Prepared = { kind: "work"; work: CaptureWork } | { kind: "done"; outcome: JobOutcome };

export const processCapture: JobHandler = async (context) => {
  const { workspaceId, childId, captureId } = context.job;
  if (workspaceId === null || childId === null || captureId === null) {
    return { status: "failed", errorCode: "unknown", retryable: false };
  }
  const ids = { workspaceId, childId, captureId };

  try {
    const prepared = await prepare(context, ids);
    if (prepared.kind === "done") return prepared.outcome;
    const transcript = await transcribeIfNeeded(context, prepared.work);
    // Null means a newer attempt already wrote this capture's transcript and owns it now.
    if (transcript === null) return supersededBy(context);
    return await extractAndCommit(context, prepared.work, transcript);
  } catch (error) {
    return reportFailure(context, ids, error);
  }
};

/**
 * Reauthorizes before any work: the workspace, the child, the capture status, and the author's
 * membership and child grant must all still be current. A revoked author's recording is cancelled
 * rather than published (architecture §4). The workspace comes from the claimed job row, which is
 * why this can open a tenant transaction at all.
 */
async function prepare(context: JobContext, ids: CaptureIds): Promise<Prepared> {
  const { runtime } = context;
  const loaded = await withTenantTransaction(runtime.db, { workspaceId: ids.workspaceId }, (tx) =>
    loadWork(runtime, tx, ids),
  );

  if (loaded.outcome === "work") return { kind: "work", work: loaded.work };
  if (loaded.outcome === "revoked") {
    await setStatus(runtime.db, ids, "cancelled");
    return {
      kind: "done",
      outcome: { status: "failed", errorCode: "cancelled", retryable: false },
    };
  }
  // A missing capture, or one already confirmed, cancelled, or reviewed, means a newer attempt or
  // the caregiver got there first. That is a successful outcome for this job, not a failure.
  return { kind: "done", outcome: { status: "completed" } };
}

type LoadResult =
  { outcome: "missing" | "settled" | "revoked" } | { outcome: "work"; work: CaptureWork };

async function loadWork(
  runtime: WorkerRuntime,
  tx: Parameters<typeof findAudioAsset>[0],
  ids: CaptureIds,
): Promise<LoadResult> {
  const capture = await capturesRepository.findCaptureInWorkspace(
    tx,
    ids.workspaceId,
    ids.captureId,
  );
  if (capture === null || capture.childId !== ids.childId) return { outcome: "missing" };
  if (!PROCESSABLE.includes(capture.status)) return { outcome: "settled" };

  const authorized = await authorizeAuthor(runtime, tx, ids, capture);
  if (authorized === null) return { outcome: "revoked" };

  const asset = await findAudioAsset(tx, ids);
  const draft = await decryptCaptureDraft(runtime.keys, {
    workspaceId: ids.workspaceId,
    captureId: ids.captureId,
    envelope: capture.contentCiphertext,
  });
  const started =
    capture.status === "processing"
      ? capture
      : await capturesRepository.updateCaptureStatus(tx, {
          workspaceId: ids.workspaceId,
          captureId: ids.captureId,
          status: "processing",
        });
  if (started === null) return { outcome: "missing" };
  return { outcome: "work", work: { ids, capture: started, asset, draft, childAlias: authorized } };
}

/** Null when the author may no longer add to this child's journal. */
async function authorizeAuthor(
  runtime: WorkerRuntime,
  tx: Parameters<typeof findAudioAsset>[0],
  ids: CaptureIds,
  capture: CaptureRow,
): Promise<string | null> {
  try {
    const authorization = await authorizeChild(tx, {
      userId: capture.authorUserId,
      workspaceId: ids.workspaceId,
      childId: ids.childId,
    });
    const access = accessContextOf(authorization.membership.appRole, authorization.permission);
    if (!canCreateCapture(access)) return null;
    return await resolveChildAlias(runtime.keys, ids, authorization.child.profileCiphertext);
  } catch (error) {
    // A missing membership, grant, or child is reported as an ordinary not-found by the
    // authorization helper; for this job it means the recording may no longer be processed.
    if (error instanceof ApiHttpError) return null;
    throw error;
  }
}

/**
 * Stage one. Skipped when the draft already holds a transcript, which is the case for a typed
 * capture and for any retry after an earlier attempt wrote one.
 */
async function transcribeIfNeeded(context: JobContext, work: CaptureWork): Promise<string | null> {
  const stored = work.draft.rawTranscript;
  if (stored !== null) return stored;

  const asset = work.asset;
  if (asset === null || (asset.status !== "uploaded" && asset.status !== "ready")) {
    throw new CaptureFailure("upload_missing");
  }

  const audio = await context.runtime.storage.readObject(asset.objectKey, AUDIO_MAX_BYTES);
  const result = await callProvider(context.runtime, "deepgram", () =>
    context.runtime.transcription.transcribe({
      audio,
      mime: asset.declaredMime,
      language: "en",
    }),
  );

  // The transcript goes into the encrypted capture and nowhere else; the checkpoint records only
  // that the stage finished (docs/pii-encryption.md, "Provider checkpoint text").
  const written = await writeDraft(context.runtime, work, {
    draft: { ...work.draft, rawTranscript: result.transcript },
    status: "processing",
  });
  if (written === null) return null;
  work.draft = { ...work.draft, rawTranscript: result.transcript };
  work.capture = written;
  await context.saveCheckpoint(TRANSCRIBED_CHECKPOINT);
  await settleAudioReservation(context.runtime, asset);
  await recordProviderUsage({
    runtime: context.runtime,
    workspaceId: work.ids.workspaceId,
    audioSeconds: Math.round((result.durationMs ?? asset.durationMs ?? 0) / 1000),
  });
  return result.transcript;
}

/**
 * Transcription is what validates a recording, so it is also what settles its reservation. This
 * closes the milestone 3 limitation where audio bytes stayed in `storage_reserved_bytes` for the
 * asset's whole life. `markAssetReady` crosses the cleanup marker, which is the once-only licence
 * to move the counter, so a retried attempt that reaches this again moves nothing.
 */
async function settleAudioReservation(runtime: WorkerRuntime, asset: MediaAssetRow): Promise<void> {
  const workspaceId = asset.workspaceId;
  await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    const ready = await mediaRepository.markAssetReady(tx, {
      workspaceId,
      assetId: asset.id,
      // The transcription provider decoded these bytes, which is the verification audio gets.
      verifiedMime: asset.declaredMime,
    });
    if (ready === null) return;
    const levels = await storageQuotaRepository.settleStorageBytes(tx, {
      workspaceId,
      reservedBytes: ready.reservedBytes,
      actualBytes: ready.sizeBytes ?? ready.reservedBytes,
    });
    recordStorageLevels(runtime.metrics, levels);
  });
}

/** Stage two. One model call, then one transaction that publishes the reviewable draft. */
async function extractAndCommit(
  context: JobContext,
  work: CaptureWork,
  transcript: string,
): Promise<JobOutcome> {
  const { runtime } = context;
  // The daily spend cap is checked immediately before the paid call, not when the job was queued.
  await assertExtractionBudget({ runtime, workspaceId: work.ids.workspaceId });
  const extracted = await callProvider(runtime, "anthropic", () =>
    runtime.extraction.extract({
      schemaVersion: 1,
      rawTranscript: transcript,
      recordingStartedAt: work.capture.capturedAt.toISOString(),
      timezone: work.capture.timezone,
      locale: work.capture.locale,
      childAlias: work.childAlias,
      promptVersion: PROMPT_VERSION,
    }),
  );

  await recordProviderUsage({
    runtime,
    workspaceId: work.ids.workspaceId,
    tokensIn: extracted.provenance.inputTokens,
    tokensOut: extracted.provenance.outputTokens,
  });

  const validated = validateExtractionSemantics(extracted.output, transcript);
  if (!validated.ok) throw new CaptureFailure("extraction_failed");

  const built = buildDraftCandidates({
    candidates: validated.value.candidates,
    notes: validated.value.notes,
    capturedAt: work.capture.capturedAt,
    timezone: work.capture.timezone,
    newId: randomUUID,
  });

  const committed = await writeDraft(runtime, work, {
    draft: {
      schemaVersion: DRAFT_SCHEMA_VERSION,
      rawTranscript: transcript,
      formattedText: extracted.output.formattedText,
      candidates: built.candidates,
      // The reviewer sees why an entry is missing; the caveat text never publishes anything.
      notes: built.notes,
    },
    status: "needs_review",
    promptVersion: extracted.provenance.promptVersion,
    modelId: extracted.provenance.modelId,
  });
  // A version mismatch here means a newer attempt already published its draft. That attempt won;
  // this one completes without writing rather than failing a recording the caregiver can see.
  if (committed === null) return supersededBy(context);
  return { status: "completed" };
}

/** Counts one paid call by provider and outcome. The label set is closed; no payload is recorded. */
async function callProvider<T>(
  runtime: WorkerRuntime,
  provider: string,
  call: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await call();
    runtime.metrics.incrementCounter("provider_calls", { stage: provider, status: "ok" });
    return result;
  } catch (error) {
    runtime.metrics.incrementCounter("provider_calls", { stage: provider, status: "failed" });
    throw error;
  } finally {
    runtime.metrics.observeDuration("provider_call_duration_ms", Date.now() - startedAt, {
      stage: provider,
    });
  }
}

/** Not a failure: the caregiver's capture is in the hands of a newer attempt. */
function supersededBy(context: JobContext): JobOutcome {
  context.runtime.logger.info("job_draft_superseded", { jobId: context.job.id });
  return { status: "completed" };
}

interface DraftWrite {
  draft: CaptureDraft;
  status: Extract<CaptureStatus, "processing" | "needs_review">;
  promptVersion?: string;
  modelId?: string;
}

/**
 * Writes the encrypted draft under the version the handler loaded, so a worker whose lease was
 * reclaimed cannot overwrite the attempt that replaced it. Returns null when it lost that race.
 */
async function writeDraft(
  runtime: WorkerRuntime,
  work: CaptureWork,
  write: DraftWrite,
): Promise<CaptureRow | null> {
  const { workspaceId, captureId } = work.ids;
  // Encryption happens before the transaction opens: a key fetch must not be held under a lock.
  const contentCiphertext = await encryptCaptureDraft(runtime.keys, {
    workspaceId,
    captureId,
    draft: write.draft,
  });
  return withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    const current = await capturesRepository.findCaptureInWorkspace(tx, workspaceId, captureId);
    if (current === null || current.status !== "processing") return null;
    return capturesRepository.updateCaptureDraft(tx, {
      workspaceId,
      captureId,
      expectedDraftVersion: work.capture.draftVersion,
      contentCiphertext,
      status: write.status,
      ...(write.promptVersion === undefined ? {} : { promptVersion: write.promptVersion }),
      ...(write.modelId === undefined ? {} : { modelId: write.modelId }),
    });
  });
}

/** The child's first name, or a neutral alias. No birthdate, roster, or history is ever sent. */
async function resolveChildAlias(
  keys: DataKeyService,
  ids: CaptureIds,
  envelope: unknown,
): Promise<string> {
  const profile = await decryptChildProfile(keys, {
    workspaceId: ids.workspaceId,
    childId: ids.childId,
    envelope,
  });
  const first = profile.name.trim().split(/\s+/)[0];
  return first === undefined || first === "" ? "the child" : first;
}

/** A failure whose capture-visible reason is already decided, and which will not be retried. */
class CaptureFailure extends Error {
  readonly errorCode: string;

  constructor(errorCode: string) {
    super(errorCode);
    this.name = "CaptureFailure";
    this.errorCode = errorCode;
  }
}

interface FailureShape {
  errorCode: string;
  retryable: boolean;
  retryAfterMs?: number | undefined;
}

function classify(error: unknown): FailureShape {
  // A crypto or key failure is terminal by contract: there is no plaintext fallback and no
  // partial event (docs/pii-encryption.md).
  if (error instanceof EncryptionError) return { errorCode: "crypto_failure", retryable: false };
  // A spent budget is not a provider fault and retrying tomorrow is the caregiver's decision.
  if (error instanceof BudgetExceededError) {
    return { errorCode: "budget_exceeded", retryable: false };
  }
  if (error instanceof CaptureFailure) return { errorCode: error.errorCode, retryable: false };
  if (error instanceof ProviderError) {
    return {
      errorCode: captureErrorCodeFor(error),
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
    };
  }
  return { errorCode: "unknown", retryable: true };
}

function captureErrorCodeFor(error: ProviderError): string {
  if (error.code === "rate_limited") return "provider_quota";
  if (error.provider === "anthropic") return "extraction_failed";
  if (error.provider === "supabase") return "invalid_audio";
  return "transcription_failed";
}

/**
 * The capture only turns `failed` on the last attempt: while retries remain it stays `processing`,
 * because the recording is still being worked on and the caregiver has nothing to decide yet.
 */
async function reportFailure(
  context: JobContext,
  ids: CaptureIds,
  error: unknown,
): Promise<JobOutcome> {
  const failure = classify(error);
  const terminal = !failure.retryable || context.job.attempts >= context.job.maxAttempts;
  if (terminal) await setStatus(context.runtime.db, ids, "failed", failure.errorCode);
  return {
    status: "failed",
    errorCode: failure.errorCode,
    retryable: failure.retryable,
    ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
  };
}

/** Never moves a capture the caregiver has already reviewed, confirmed, or discarded. */
async function setStatus(
  db: HandoffDatabase,
  ids: CaptureIds,
  status: CaptureStatus,
  errorCode?: string,
): Promise<void> {
  await withTenantTransaction(db, { workspaceId: ids.workspaceId }, async (tx) => {
    const current = await capturesRepository.findCaptureInWorkspace(
      tx,
      ids.workspaceId,
      ids.captureId,
    );
    if (current === null || !PROCESSABLE.includes(current.status)) return;
    await capturesRepository.updateCaptureStatus(tx, {
      workspaceId: ids.workspaceId,
      captureId: ids.captureId,
      status,
      ...(errorCode === undefined ? {} : { errorCode }),
    });
  });
}
