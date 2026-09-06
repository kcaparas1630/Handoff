// Drafts: the reviewable step between what a caregiver reported and what the journal publishes.
// Nothing here creates an event; only `confirmCapture` does, in one transaction under the child
// lock (data contract §3).
import { randomUUID } from "node:crypto";
import {
  capturesRepository,
  careRepository,
  jobsRepository,
  withTenantTransaction,
} from "@handoff/db";
import { canCreateCapture, canReadOtherAuthorDraft, validateEventSemantics } from "@handoff/domain";
import type {
  CaptureDraft,
  CaptureDto,
  CreateCaptureRequest,
  DraftCandidate,
  UpdateCaptureDraftRequest,
  UploadAuthorization,
} from "@handoff/contracts";
import type { CaptureRow, CaptureStatus, HandoffTransaction, MediaAssetRow } from "@handoff/db";
import { authorizeChild } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { accessContextOf } from "../lib/access-context";
import { inTenantTransaction } from "../lib/in-tenant-transaction";
import { toMediaAssetDto } from "../lib/media-dto";
import { decryptCaptureDraft, encryptCaptureDraft } from "../security/journal-fields";
import {
  allocateAudioAsset,
  assertAudioIsAllowed,
  authorizeAudioUpload,
  findAudioAsset,
  requireStorage,
} from "./capture-uploads";
import { processCaptureDedupeKey } from "./job-keys";
import { resolveCaptureWorkspace, resolveChildWorkspace } from "./workspace-lookup";
import type { ChildAuthorization } from "../types/authorization";
import type { ScopedTransaction } from "../lib/in-tenant-transaction";
import type { ServiceDeps } from "../types/runtime";

const DRAFT_SCHEMA_VERSION = 1;

export interface AuthorizedCapture {
  capture: CaptureRow;
  authorization: ChildAuthorization;
  isAuthor: boolean;
}

/** Rejects a reviewed line whose values could not describe care that happened. */
export function assertCandidatesAreValid(candidates: readonly DraftCandidate[]): void {
  const fieldErrors: Record<string, string[]> = {};
  candidates.forEach((candidate, index) => {
    if (candidate.discarded) return;
    const result = validateEventSemantics({
      kind: candidate.kind,
      occurredAt: candidate.occurredAt === null ? null : new Date(candidate.occurredAt),
      endedAt: candidate.endedAt === null ? null : new Date(candidate.endedAt),
      timePrecision: candidate.timePrecision,
      amountValue: candidate.amountValue,
      amountUnit: candidate.amountUnit,
      details: candidate.details,
    });
    if (result.ok) return;
    for (const error of result.errors) {
      (fieldErrors[`candidates.${String(index)}.${error.field}`] ??= []).push(error.message);
    }
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw ApiHttpError.validationFailed("That entry cannot be saved as written", fieldErrors);
  }
}

export interface CaptureDtoExtras {
  /** Omitted when the caller has not loaded it; absent means the same as null in the contract. */
  audioAsset?: MediaAssetRow | null;
  /** Returned only on creation and on an authorized re-read while awaiting upload. */
  upload?: UploadAuthorization | null;
}

export async function toCaptureDto(
  deps: ServiceDeps,
  capture: CaptureRow,
  canReadDraft: boolean,
  extras: CaptureDtoExtras = {},
): Promise<CaptureDto> {
  const draft =
    canReadDraft && capture.contentCiphertext !== null
      ? await decryptCaptureDraft(deps.keys, {
          workspaceId: capture.workspaceId,
          captureId: capture.id,
          envelope: capture.contentCiphertext,
        })
      : null;
  return {
    id: capture.id,
    childId: capture.childId,
    workspaceId: capture.workspaceId,
    authorUserId: capture.authorUserId,
    inputKind: capture.inputKind,
    status: capture.status,
    capturedAt: capture.capturedAt.toISOString(),
    timezone: capture.timezone,
    locale: capture.locale,
    draftVersion: capture.draftVersion,
    draft,
    errorCode: capture.errorCode,
    confirmedAt: capture.confirmedAt === null ? null : capture.confirmedAt.toISOString(),
    ...(extras.audioAsset === undefined
      ? {}
      : { audioAsset: extras.audioAsset === null ? null : toMediaAssetDto(extras.audioAsset) }),
    ...(extras.upload === undefined ? {} : { upload: extras.upload }),
    version: capture.version,
    createdAt: capture.createdAt.toISOString(),
  };
}

/**
 * A capture is visible to its author and to a workspace owner. Anyone else gets the same 404 as
 * an unknown id: another caregiver's unconfirmed draft is not a fact they may read (§7).
 */
export async function loadAuthorizedCapture(
  tx: HandoffTransaction,
  input: { actorUserId: string; workspaceId: string; captureId: string },
): Promise<AuthorizedCapture> {
  const capture = await capturesRepository.findCaptureInWorkspace(
    tx,
    input.workspaceId,
    input.captureId,
  );
  if (capture === null) throw ApiHttpError.notFound("That recording is not available");

  const authorization = await authorizeChild(tx, {
    userId: input.actorUserId,
    workspaceId: input.workspaceId,
    childId: capture.childId,
  });
  const isAuthor = capture.authorUserId === input.actorUserId;
  const context = accessContextOf(authorization.membership.appRole, authorization.permission);
  if (!isAuthor && !canReadOtherAuthorDraft(context)) {
    throw ApiHttpError.notFound("That recording is not available");
  }
  return { capture, authorization, isAuthor };
}

export async function createCapture({
  deps,
  actorUserId,
  input,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  input: CreateCaptureRequest;
  /** Supplied by an idempotent route so this write and its replay record commit together. */
  tx?: ScopedTransaction;
}): Promise<CaptureDto> {
  const workspaceId =
    tx?.workspaceId ?? (await resolveChildWorkspace({ deps, actorUserId, childId: input.childId }));
  const captureId = randomUUID();
  // A recording is refused for its declared shape before anything is reserved, and refused
  // outright when storage is unconfigured rather than accepted with nowhere to go.
  const storage = input.inputKind === "audio" ? requireStorage(deps.storage) : null;
  if (input.audio !== undefined) assertAudioIsAllowed(input.audio);

  const created = await inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const authorization = await authorizeChild(scoped, {
      userId: actorUserId,
      workspaceId,
      childId: input.childId,
    });
    const context = accessContextOf(authorization.membership.appRole, authorization.permission);
    if (!canCreateCapture(context)) {
      throw ApiHttpError.forbidden("You can read this child's journal but not add to it");
    }
    await assertOwnOpenSession(scoped, {
      workspaceId,
      childId: input.childId,
      actorUserId,
      careSessionId: input.careSessionId,
    });

    const draft = buildDraft(input);
    assertCandidatesAreValid(draft.candidates);
    const contentCiphertext = await encryptCaptureDraft(deps.keys, {
      workspaceId,
      captureId,
      draft,
    });

    const capture = await capturesRepository.insertCapture(scoped, {
      id: captureId,
      workspaceId,
      childId: input.childId,
      authorUserId: actorUserId,
      ...(input.careSessionId === undefined ? {} : { careSessionId: input.careSessionId }),
      clientCaptureId: input.clientCaptureId,
      inputKind: input.inputKind,
      capturedAt: new Date(input.capturedAt),
      timezone: input.timezone,
      locale: input.locale,
      contentCiphertext,
      schemaVersion: DRAFT_SCHEMA_VERSION,
      status: initialStatusFor(input.inputKind),
    });

    if (capture.inputKind === "audio" && storage !== null && input.audio !== undefined) {
      // A resubmitted client capture id returns the capture that already exists; its allocation
      // exists too, so the quota is not reserved and a second object is not allocated.
      const existing = await findAudioAsset(scoped, {
        workspaceId,
        childId: capture.childId,
        captureId: capture.id,
      });
      const asset =
        existing ??
        (await allocateAudioAsset(scoped, {
          storage,
          workspaceId,
          childId: capture.childId,
          captureId: capture.id,
          uploadedByUserId: actorUserId,
          audio: input.audio,
          now: deps.now(),
        }));
      return { capture, asset };
    }

    if (capture.inputKind === "text") {
      // Typed text has nothing to upload, so its processing is queued in this same transaction.
      // The dedupe key makes a replayed creation schedule the work once (data contract section 5).
      await jobsRepository.enqueueJob(scoped, {
        kind: "process_capture",
        dedupeKey: processCaptureDedupeKey(capture.id),
        workspaceId,
        childId: capture.childId,
        captureId: capture.id,
        payload: { captureId: capture.id },
      });
    }
    return { capture, asset: null };
  });

  // The draft of a replayed capture was encrypted under its own row id, not the one allocated
  // above, which is why the returned row is what gets decrypted here.
  if (created.asset === null || storage === null) return toCaptureDto(deps, created.capture, true);
  return toCaptureDto(deps, created.capture, true, {
    audioAsset: created.asset,
    upload: await authorizeAudioUpload(storage, created.asset),
  });
}

/** Audio waits for its object, text waits for the worker, manual entry is already reviewed. */
function initialStatusFor(inputKind: CreateCaptureRequest["inputKind"]): CaptureStatus {
  if (inputKind === "audio") return "awaiting_upload";
  if (inputKind === "text") return "queued";
  return "needs_review";
}

/**
 * Manual entry arrives already reviewed, so it becomes one candidate per reported fact. Typed
 * text is stored as the raw transcript, which is what the extraction job reads. An audio capture
 * starts from an encrypted empty draft: it has no transcript until the worker writes one.
 */
function buildDraft(input: CreateCaptureRequest): CaptureDraft {
  if (input.inputKind === "text" || input.inputKind === "audio") {
    return {
      schemaVersion: DRAFT_SCHEMA_VERSION,
      rawTranscript: input.inputKind === "text" ? (input.text ?? null) : null,
      formattedText: null,
      candidates: [],
      notes: [],
    };
  }
  return {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    rawTranscript: null,
    formattedText: null,
    // Manual entry has no transcript, so a span into one cannot mean anything.
    candidates: (input.candidates ?? []).map((candidate) => ({
      ...candidate,
      sourceStart: null,
      sourceEnd: null,
    })),
    // Nothing was extracted, so there is nothing for the reviewer to double-check.
    notes: [],
  };
}

/** An optional session must be the caller's own open session for this child (§3). */
async function assertOwnOpenSession(
  tx: HandoffTransaction,
  input: {
    workspaceId: string;
    childId: string;
    actorUserId: string;
    careSessionId: string | undefined;
  },
): Promise<void> {
  if (input.careSessionId === undefined) return;
  const open = await careRepository.findOpenSessionForUser(
    tx,
    input.workspaceId,
    input.childId,
    input.actorUserId,
  );
  if (open === null || open.id !== input.careSessionId) {
    throw ApiHttpError.validationFailed("That care session is not your open session", {
      careSessionId: ["Expected the caller's open session for this child"],
    });
  }
}

export async function getCapture({
  deps,
  actorUserId,
  captureId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  captureId: string;
}): Promise<CaptureDto> {
  const workspaceId = await resolveCaptureWorkspace({ deps, actorUserId, captureId });
  const loaded = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const authorized = await loadAuthorizedCapture(tx, { actorUserId, workspaceId, captureId });
    const asset = await findAudioAsset(tx, {
      workspaceId,
      childId: authorized.capture.childId,
      captureId,
    });
    return { ...authorized, asset };
  });

  // An expired upload authorization is re-signed for the author rather than resent: the asset row
  // is the source of truth and a signed URL is never stored or replayed (docs/pii-encryption.md).
  const storage = deps.storage;
  const asset = loaded.asset;
  const upload =
    loaded.isAuthor &&
    loaded.capture.status === "awaiting_upload" &&
    asset !== null &&
    asset.status === "pending_upload" &&
    storage !== null
      ? await authorizeAudioUpload(storage, asset)
      : null;
  return toCaptureDto(deps, loaded.capture, true, { audioAsset: asset, upload });
}

export async function updateCaptureDraft({
  deps,
  actorUserId,
  captureId,
  input,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  captureId: string;
  input: UpdateCaptureDraftRequest;
  tx?: ScopedTransaction;
}): Promise<CaptureDto> {
  const workspaceId =
    tx?.workspaceId ?? (await resolveCaptureWorkspace({ deps, actorUserId, captureId }));

  const updated = await inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const { capture, isAuthor } = await loadAuthorizedCapture(scoped, {
      actorUserId,
      workspaceId,
      captureId,
    });
    // An owner may read another author's draft but never edit it; the author owns their report.
    if (!isAuthor) throw ApiHttpError.forbidden("Only the author can edit this draft");
    if (capture.status === "confirmed") {
      throw ApiHttpError.conflict("This recording was already confirmed");
    }
    assertCandidatesAreValid(input.candidates);

    const stored =
      capture.contentCiphertext === null
        ? null
        : await decryptCaptureDraft(deps.keys, {
            workspaceId,
            captureId,
            envelope: capture.contentCiphertext,
          });
    const contentCiphertext = await encryptCaptureDraft(deps.keys, {
      workspaceId,
      captureId,
      draft: {
        schemaVersion: DRAFT_SCHEMA_VERSION,
        rawTranscript: stored?.rawTranscript ?? null,
        formattedText: stored?.formattedText ?? null,
        candidates: input.candidates,
        // The caveats describe the extraction, not the edit, so an edit keeps them.
        notes: stored?.notes ?? [],
      },
    });
    const row = await capturesRepository.updateCaptureDraft(scoped, {
      workspaceId,
      captureId,
      expectedDraftVersion: input.expectedDraftVersion,
      contentCiphertext,
    });
    if (row === null) throw ApiHttpError.conflict("This draft changed since you loaded it");
    return row;
  });

  return toCaptureDto(deps, updated, true);
}
