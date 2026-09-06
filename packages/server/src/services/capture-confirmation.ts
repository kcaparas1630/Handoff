// The only path that creates events. Everything it publishes happens inside one transaction:
// lock the child, allocate a sequence per candidate, write each event with its first revision,
// then close the capture (architecture §5).
import { randomUUID } from "node:crypto";
import {
  capturesRepository,
  eventsRepository,
  infrastructureRepository,
  mediaRepository,
} from "@handoff/db";
import { canCreateCapture } from "@handoff/domain";
import type {
  ConfirmCaptureRequest,
  ConfirmCaptureResponse,
  DraftCandidate,
  EventDto,
} from "@handoff/contracts";
import type { CaptureRow, HandoffTransaction } from "@handoff/db";
import { ApiHttpError } from "../http/errors";
import { accessContextOf } from "../lib/access-context";
import { eventPayloadOf, revisionSnapshotOf, toEventDto } from "../lib/event-dto";
import { inTenantTransaction } from "../lib/in-tenant-transaction";
import {
  decryptCaptureDraft,
  decryptEventPayload,
  decryptRevisionSnapshot,
  encryptCaptureDraft,
  encryptEventPayload,
  encryptRevisionSnapshot,
} from "../security/journal-fields";
import { assertCandidatesAreValid, loadAuthorizedCapture, toCaptureDto } from "./captures";
import { resolveCaptureWorkspace } from "./workspace-lookup";
import type { EventFacts } from "../types/journal";
import type { ScopedTransaction } from "../lib/in-tenant-transaction";
import type { ServiceDeps } from "../types/runtime";

const DRAFT_SCHEMA_VERSION = 1;

export async function confirmCapture({
  deps,
  actorUserId,
  captureId,
  input,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  captureId: string;
  input: ConfirmCaptureRequest;
  /** Supplied by an idempotent route; the service is safe without it. */
  tx?: ScopedTransaction;
}): Promise<ConfirmCaptureResponse> {
  const workspaceId =
    tx?.workspaceId ?? (await resolveCaptureWorkspace({ deps, actorUserId, captureId }));

  return inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const loaded = await loadAuthorizedCapture(scoped, { actorUserId, workspaceId, captureId });
    const context = accessContextOf(
      loaded.authorization.membership.appRole,
      loaded.authorization.permission,
    );
    // An owner can read another author's draft, but the author is the one who confirms their
    // own reported facts (§7).
    if (!loaded.isAuthor) throw ApiHttpError.forbidden("Only the author can confirm this draft");
    if (!canCreateCapture(context)) {
      throw ApiHttpError.forbidden("You can read this child's journal but not add to it");
    }
    if (loaded.capture.status === "confirmed") {
      return replayConfirmation(scoped, deps, loaded.capture);
    }
    if (loaded.capture.status !== "needs_review") {
      throw ApiHttpError.conflict("This recording is not ready to confirm");
    }

    // The child lock is the serialization point. Two concurrent confirmations of one capture
    // queue here, and the loser re-reads a confirmed capture and replays.
    const locked = await eventsRepository.lockChildForJournalWrite(
      scoped,
      workspaceId,
      loaded.capture.childId,
    );
    if (locked === null) throw ApiHttpError.notFound("That child is not available");

    const capture = await capturesRepository.findCaptureInWorkspace(scoped, workspaceId, captureId);
    if (capture === null) throw ApiHttpError.notFound("That recording is not available");
    if (capture.status === "confirmed") return replayConfirmation(scoped, deps, capture);
    if (capture.draftVersion !== input.expectedDraftVersion) {
      throw ApiHttpError.conflict("This draft changed since you loaded it");
    }

    const draft = await decryptCaptureDraft(deps.keys, {
      workspaceId,
      captureId,
      envelope: capture.contentCiphertext,
    });
    const reviewed = mergeReviewedCandidates(draft.candidates, input);
    assertCandidatesAreValid(reviewed.published);

    // An attachment validated while the draft was under review is published with the events it
    // belongs to, rather than waiting for a `media_updated` revision (architecture §6).
    const readyAssetIds = await readyAttachmentIds(scoped, capture);
    const events: EventDto[] = [];
    for (const candidate of reviewed.published) {
      events.push(
        await publishCandidate(scoped, deps, {
          capture,
          actorUserId,
          candidate,
          readyAssetIds,
        }),
      );
    }

    // The reviewed values become the stored draft, so the capture stays an accurate source.
    const edited = await capturesRepository.updateCaptureDraft(scoped, {
      workspaceId,
      captureId,
      expectedDraftVersion: capture.draftVersion,
      contentCiphertext: await encryptCaptureDraft(deps.keys, {
        workspaceId,
        captureId,
        draft: { ...draft, schemaVersion: DRAFT_SCHEMA_VERSION, candidates: reviewed.stored },
      }),
    });
    if (edited === null) throw ApiHttpError.conflict("This draft changed since you loaded it");

    const confirmed = await capturesRepository.markCaptureConfirmed(scoped, {
      workspaceId,
      captureId,
      expectedVersion: edited.version,
    });
    if (confirmed === null)
      throw ApiHttpError.conflict("This recording changed since you loaded it");

    await infrastructureRepository.insertAuditLog(scoped, {
      workspaceId,
      childId: capture.childId,
      actorUserId,
      action: "capture.confirmed",
      entityType: "capture",
      entityId: captureId,
      requestId: deps.requestId,
    });
    return { capture: await toCaptureDto(deps, confirmed, true), events };
  });
}

interface ReviewedCandidates {
  /** The whole draft after review, kept in its original order. */
  stored: DraftCandidate[];
  /** The subset this confirmation publishes. */
  published: DraftCandidate[];
}

/**
 * Reviewed values are merged onto the stored candidates by id. Source quote and spans stay as
 * stored, so a client cannot repoint a confirmed event at different transcript text.
 */
function mergeReviewedCandidates(
  storedCandidates: readonly DraftCandidate[],
  input: ConfirmCaptureRequest,
): ReviewedCandidates {
  const byId = new Map(storedCandidates.map((candidate) => [candidate.id, candidate]));
  const reviewedById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  for (const id of reviewedById.keys()) {
    if (byId.has(id)) continue;
    throw ApiHttpError.validationFailed("That entry is not part of this recording", {
      candidates: ["Expected the ids of this recording's own draft entries"],
    });
  }

  const stored: DraftCandidate[] = [];
  const published: DraftCandidate[] = [];
  for (const candidate of storedCandidates) {
    const reviewed = reviewedById.get(candidate.id);
    if (reviewed === undefined) {
      stored.push(candidate);
      continue;
    }
    const merged: DraftCandidate = {
      ...reviewed,
      sourceQuote: candidate.sourceQuote,
      sourceStart: candidate.sourceStart,
      sourceEnd: candidate.sourceEnd,
    };
    stored.push(merged);
    if (!merged.discarded) published.push(merged);
  }
  return { stored, published };
}

/**
 * By default every event from a one-child capture references its attachments (architecture §6).
 * Only ready photos and videos count: an upload still being inspected, or one that was rejected,
 * must never appear on a published event.
 */
async function readyAttachmentIds(tx: HandoffTransaction, capture: CaptureRow): Promise<string[]> {
  const assets = await mediaRepository.listAssetsForCapture(tx, {
    workspaceId: capture.workspaceId,
    childId: capture.childId,
    captureId: capture.id,
  });
  return assets
    .filter((asset) => asset.status === "ready" && asset.kind !== "audio")
    .map((asset) => asset.id);
}

async function publishCandidate(
  tx: HandoffTransaction,
  deps: ServiceDeps,
  input: {
    capture: CaptureRow;
    actorUserId: string;
    candidate: DraftCandidate;
    readyAssetIds: readonly string[];
  },
): Promise<EventDto> {
  const { capture, candidate } = input;
  const journalSeq = await eventsRepository.allocateJournalSeq(
    tx,
    capture.workspaceId,
    capture.childId,
  );
  const eventId = randomUUID();
  const revisionId = randomUUID();
  const facts: EventFacts = {
    kind: candidate.kind,
    occurredAt: candidate.occurredAt === null ? null : new Date(candidate.occurredAt),
    endedAt: candidate.endedAt === null ? null : new Date(candidate.endedAt),
    timezone: capture.timezone,
    timePrecision: candidate.timePrecision,
    amountValue: candidate.amountValue,
    amountUnit: candidate.amountUnit,
    details: candidate.details,
    important: candidate.important,
    status: "active",
  };

  const written = await eventsRepository.insertEventWithRevision(tx, {
    event: {
      id: eventId,
      workspaceId: capture.workspaceId,
      childId: capture.childId,
      captureId: capture.id,
      sourceCandidateId: candidate.id,
      createdByUserId: input.actorUserId,
      lastEditedByUserId: input.actorUserId,
      kind: facts.kind,
      occurredAt: facts.occurredAt,
      endedAt: facts.endedAt,
      timezone: facts.timezone,
      timePrecision: facts.timePrecision,
      payloadCiphertext: await encryptEventPayload(deps.keys, {
        workspaceId: capture.workspaceId,
        eventId,
        payload: eventPayloadOf(facts),
      }),
      important: facts.important,
      currentRevisionId: revisionId,
    },
    revision: {
      id: revisionId,
      workspaceId: capture.workspaceId,
      childId: capture.childId,
      eventId,
      journalSeq,
      eventVersion: 1,
      operation: "created",
      actorUserId: input.actorUserId,
      contentCiphertext: await encryptRevisionSnapshot(deps.keys, {
        workspaceId: capture.workspaceId,
        revisionId,
        snapshot: revisionSnapshotOf(facts, candidate.sourceQuote, input.readyAssetIds),
      }),
      sourceStart: candidate.sourceStart,
      sourceEnd: candidate.sourceEnd,
    },
  });
  return toEventDto(
    written.event,
    eventPayloadOf(facts),
    candidate.sourceQuote,
    input.readyAssetIds,
  );
}

/**
 * A confirmation that arrives after the capture is already confirmed returns the events it
 * created, not a conflict: the retried request had exactly the effect the caller asked for.
 */
async function replayConfirmation(
  tx: HandoffTransaction,
  deps: ServiceDeps,
  capture: CaptureRow,
): Promise<ConfirmCaptureResponse> {
  const draft = await decryptCaptureDraft(deps.keys, {
    workspaceId: capture.workspaceId,
    captureId: capture.id,
    envelope: capture.contentCiphertext,
  });
  const order = new Map(draft.candidates.map((candidate, index) => [candidate.id, index]));
  const quotes = new Map(
    draft.candidates.map((candidate) => [candidate.id, candidate.sourceQuote]),
  );
  const rows = await eventsRepository.listEventsForCapture(tx, capture.workspaceId, capture.id);
  rows.sort(
    (a, b) => (order.get(a.sourceCandidateId) ?? 0) - (order.get(b.sourceCandidateId) ?? 0),
  );
  // Attachments may have been published since the original confirmation, so a replay reports the
  // current revisions rather than what the first response happened to contain.
  const revisions = await eventsRepository.listRevisionsByIds(
    tx,
    capture.workspaceId,
    capture.childId,
    rows.map((row) => row.currentRevisionId),
  );
  const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]));

  const events: EventDto[] = [];
  for (const row of rows) {
    const payload = await decryptEventPayload(deps.keys, {
      workspaceId: row.workspaceId,
      eventId: row.id,
      envelope: row.payloadCiphertext,
    });
    const current = revisionsById.get(row.currentRevisionId);
    const snapshot =
      current === undefined
        ? null
        : await decryptRevisionSnapshot(deps.keys, {
            workspaceId: row.workspaceId,
            revisionId: current.id,
            envelope: current.contentCiphertext,
          });
    events.push(
      toEventDto(
        row,
        payload,
        quotes.get(row.sourceCandidateId) ?? null,
        snapshot?.readyAssetIds ?? [],
      ),
    );
  }
  return { capture: await toCaptureDto(deps, capture, true), events };
}
