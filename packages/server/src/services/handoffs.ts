// Brief generation: one recipient's bounded view of what changed for one child. The whole
// selection runs in a repeatable-read transaction so the cutoff, the source revisions, the
// context, and the saved snapshot agree (data contract §4).
import { randomUUID } from "node:crypto";
import {
  capturesRepository,
  careRepository,
  eventsRepository,
  handoffsRepository,
  identityRepository,
  withTenantTransaction,
} from "@handoff/db";
import { isCompletedCareFact, renderBrief } from "@handoff/domain";
import type { BriefSnapshot, ContextFactKind, HandoffBriefDto } from "@handoff/contracts";
import type { EventRevisionRow, HandoffBriefRow, HandoffTransaction } from "@handoff/db";
import type { LatestKnownFacts, RevisionForBrief } from "@handoff/domain";
import { authorizeChild } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import {
  decryptBriefSnapshot,
  decryptRevisionSnapshot,
  encryptBriefSnapshot,
} from "../security/journal-fields";
import { decryptUserProfile } from "../security/profile-fields";
import { withRequestKeyCache } from "../security/request-key-cache";
import { toCareSessionDtos } from "./care";
import { resolveBriefWorkspace, resolveChildWorkspace } from "./workspace-lookup";
import type { ServiceDeps } from "../types/runtime";

/** Disclosed first-handoff window: the last 24 hours, plus labeled latest-known context. */
const INITIAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const CONTEXT_KINDS: readonly ContextFactKind[] = ["feed", "sleep", "diaper"];

export async function createBrief({
  deps,
  actorUserId,
  childId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  childId: string;
}): Promise<HandoffBriefDto> {
  const workspaceId = await resolveChildWorkspace({ deps, actorUserId, childId });
  const now = deps.now();
  // One window can hold thousands of revisions under one data key; resolving that key per row
  // would dominate the whole brief.
  const scoped: ServiceDeps = { ...deps, keys: withRequestKeyCache(deps.keys) };

  return withTenantTransaction(
    scoped.db,
    { workspaceId, isolationLevel: "repeatable read" },
    async (tx) => {
      const authorized = await authorizeChild(tx, { userId: actorUserId, workspaceId, childId });
      const cursor = await handoffsRepository.findCursor(tx, workspaceId, childId, actorUserId);
      const fromSeqExclusive = cursor?.acknowledgedSeq ?? 0;
      const throughSeqInclusive = authorized.child.journalSeq;
      // Only a recipient who has never acknowledged anything gets the disclosed 24 hour window;
      // everyone else sees every unacknowledged change through the cutoff.
      const isFirstHandoff =
        fromSeqExclusive === 0 && (cursor?.lastAcknowledgedBriefId ?? null) === null;
      const initialWindowStart = isFirstHandoff
        ? new Date(now.getTime() - INITIAL_WINDOW_MS)
        : null;

      const rows =
        initialWindowStart === null
          ? await eventsRepository.listRevisionsInWindow(
              tx,
              childId,
              fromSeqExclusive,
              throughSeqInclusive,
            )
          : (
              await eventsRepository.listInitialWindowRevisions(tx, {
                workspaceId,
                childId,
                throughSeqInclusive,
                since: initialWindowStart,
              })
            ).map((row) => row.revision);

      const names = await readActorDisplayNames(tx, scoped, rows);
      const revisions: RevisionForBrief[] = await Promise.all(
        rows.map(async (row) => ({
          revisionId: row.id,
          eventId: row.eventId,
          journalSeq: row.journalSeq,
          eventVersion: row.eventVersion,
          operation: row.operation,
          actorDisplayName: names.get(row.actorUserId) ?? null,
          createdAt: row.createdAt,
          snapshot: await decryptRevisionSnapshot(scoped.keys, {
            workspaceId,
            revisionId: row.id,
            envelope: row.contentCiphertext,
          }),
        })),
      );

      const snapshot = renderBrief({
        revisions,
        latestKnown: await readLatestKnownFacts(tx, scoped, { workspaceId, childId }),
        boundary: { fromSeqExclusive, throughSeqInclusive, initialWindowStart },
        pendingCaptureCount: await capturesRepository.countPendingCapturesForChild(
          tx,
          workspaceId,
          childId,
        ),
        now,
        timezone: authorized.workspace.timezone,
      });

      const briefId = randomUUID();
      const brief = await handoffsRepository.insertBrief(tx, {
        id: briefId,
        workspaceId,
        childId,
        recipientUserId: actorUserId,
        fromSeqExclusive,
        throughSeqInclusive,
        initialWindowStart,
        snapshotCiphertext: await encryptBriefSnapshot(scoped.keys, {
          workspaceId,
          briefId,
          snapshot,
        }),
        rendererVersion: snapshot.rendererVersion,
      });
      return toBriefDto(tx, scoped, {
        brief,
        snapshot,
        journalSeq: throughSeqInclusive,
      });
    },
  );
}

export async function getBrief({
  deps,
  actorUserId,
  briefId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  briefId: string;
}): Promise<HandoffBriefDto> {
  const workspaceId = await resolveBriefWorkspace({ deps, actorUserId, briefId });
  return withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const brief = await handoffsRepository.findBriefForRecipient(
      tx,
      workspaceId,
      briefId,
      actorUserId,
    );
    if (brief === null) throw ApiHttpError.notFound("That handoff is not available");
    // Access is rechecked on every fetch: a stored snapshot is never served as current truth to
    // someone who has since lost the child (architecture §5).
    const authorized = await authorizeChild(tx, {
      userId: actorUserId,
      workspaceId,
      childId: brief.childId,
    });
    return toBriefDto(tx, deps, {
      brief,
      snapshot: await readBriefSnapshot(deps, brief),
      journalSeq: authorized.child.journalSeq,
    });
  });
}

export async function readBriefSnapshot(
  deps: ServiceDeps,
  brief: HandoffBriefRow,
): Promise<BriefSnapshot> {
  const snapshot = await decryptBriefSnapshot(deps.keys, {
    workspaceId: brief.workspaceId,
    briefId: brief.id,
    envelope: brief.snapshotCiphertext,
  });
  if (brief.status !== "redacted") return snapshot;
  // A redacted brief keeps its boundary and its counts, but its entries are no longer readable.
  return { ...snapshot, essentials: [], updates: [], moments: [] };
}

export async function toBriefDto(
  tx: HandoffTransaction,
  deps: ServiceDeps,
  input: { brief: HandoffBriefRow; snapshot: BriefSnapshot; journalSeq: number },
): Promise<HandoffBriefDto> {
  const { brief, snapshot } = input;
  const sessions = await careRepository.listActiveSessionsForChild(
    tx,
    brief.workspaceId,
    brief.childId,
  );
  const newerChangeCount = Math.max(0, input.journalSeq - brief.throughSeqInclusive);
  return {
    id: brief.id,
    childId: brief.childId,
    workspaceId: brief.workspaceId,
    recipientUserId: brief.recipientUserId,
    status: brief.status,
    acknowledgedAt: brief.acknowledgedAt === null ? null : brief.acknowledgedAt.toISOString(),
    startedSessionId: brief.startedSessionId,
    snapshot,
    isStale: newerChangeCount > 0,
    newerChangeCount,
    activeSessions: await toCareSessionDtos(tx, deps, sessions),
  };
}

/** One decrypt per distinct author in the window, not one per revision. */
async function readActorDisplayNames(
  tx: HandoffTransaction,
  deps: ServiceDeps,
  rows: readonly EventRevisionRow[],
): Promise<Map<string, string | null>> {
  const entries = await Promise.all(
    [...new Set(rows.map((row) => row.actorUserId))].map(async (userId) => {
      const user = await identityRepository.findUserById(tx, userId);
      const displayName =
        user === null ? null : await decryptUserProfile(deps.keys, user.id, user.profileCiphertext);
      return [userId, displayName] as const;
    }),
  );
  return new Map(entries);
}

/**
 * Latest-known feed, sleep, and diaper, which may well precede the change window. They are
 * labeled context rather than updates, and a plan or a question can never become one.
 */
async function readLatestKnownFacts(
  tx: HandoffTransaction,
  deps: ServiceDeps,
  input: { workspaceId: string; childId: string },
): Promise<LatestKnownFacts> {
  const facts: LatestKnownFacts = {};
  for (const kind of CONTEXT_KINDS) {
    const event = await eventsRepository.findLatestConfirmedFactByKind(tx, { ...input, kind });
    if (event === null) continue;
    const revisions = await eventsRepository.listRevisionsForEvent(
      tx,
      event.workspaceId,
      event.childId,
      event.id,
    );
    const current = revisions.find((revision) => revision.id === event.currentRevisionId);
    if (current === undefined) continue;
    const snapshot = await decryptRevisionSnapshot(deps.keys, {
      workspaceId: input.workspaceId,
      revisionId: current.id,
      envelope: current.contentCiphertext,
    });
    if (!isCompletedCareFact(snapshot.event.kind, snapshot.event.details)) continue;
    facts[kind] = {
      eventId: event.id,
      revisionId: current.id,
      journalSeq: current.journalSeq,
      createdAt: current.createdAt,
      snapshot,
    };
  }
  return facts;
}
