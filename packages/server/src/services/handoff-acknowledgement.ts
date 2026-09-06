// "I've read this": one recipient consumes one brief's cutoff, and optionally starts their own
// care session in the same transaction. Lock order is child → cursor → brief → session, which is
// the order every other journal write takes (data contract §4).
import { randomUUID } from "node:crypto";
import {
  careRepository,
  eventsRepository,
  handoffsRepository,
  infrastructureRepository,
} from "@handoff/db";
import type { AcknowledgeBriefRequest, AcknowledgeBriefResponse } from "@handoff/contracts";
import { authorizeChild } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { inTenantTransaction } from "../lib/in-tenant-transaction";
import { toCareSessionDtos } from "./care";
import { readBriefSnapshot, toBriefDto } from "./handoffs";
import { resolveBriefWorkspace } from "./workspace-lookup";
import type { CareSessionRow, HandoffTransaction } from "@handoff/db";
import type { ScopedTransaction } from "../lib/in-tenant-transaction";
import type { ServiceDeps } from "../types/runtime";

export async function acknowledgeBrief({
  deps,
  actorUserId,
  briefId,
  input,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  briefId: string;
  input: AcknowledgeBriefRequest;
  /** Supplied by an idempotent route so this write and its replay record commit together. */
  tx?: ScopedTransaction;
}): Promise<AcknowledgeBriefResponse> {
  const workspaceId =
    tx?.workspaceId ?? (await resolveBriefWorkspace({ deps, actorUserId, briefId }));

  return inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const located = await handoffsRepository.findBriefForRecipient(
      scoped,
      workspaceId,
      briefId,
      actorUserId,
    );
    // Another recipient's brief is not visible, so acknowledging it is the same 404 as an
    // unknown id.
    if (located === null) throw ApiHttpError.notFound("That handoff is not available");
    await authorizeChild(scoped, { userId: actorUserId, workspaceId, childId: located.childId });

    const child = await eventsRepository.lockChildForJournalWrite(
      scoped,
      workspaceId,
      located.childId,
    );
    if (child === null) throw ApiHttpError.notFound("That child is not available");
    const cursor = await handoffsRepository.lockCursorForUpdate(
      scoped,
      workspaceId,
      located.childId,
      actorUserId,
    );
    const brief = await handoffsRepository.findBriefForRecipient(
      scoped,
      workspaceId,
      briefId,
      actorUserId,
    );
    if (brief === null) throw ApiHttpError.notFound("That handoff is not available");
    if (brief.status !== "ready") {
      throw ApiHttpError.conflict("This handoff can no longer be acknowledged");
    }

    const snapshot = await readBriefSnapshot(deps, brief);
    if (brief.acknowledgedAt !== null) {
      // Replay: the cursor already consumed this cutoff and any session is already open.
      return {
        brief: await toBriefDto(scoped, deps, {
          brief,
          snapshot,
          journalSeq: child.journalSeq,
        }),
        acknowledgedSeq: cursor.acknowledgedSeq,
        session: await toSessionDto(
          scoped,
          deps,
          await startedSession(scoped, brief.startedSessionId, {
            workspaceId,
            childId: brief.childId,
            userId: actorUserId,
          }),
        ),
      };
    }

    const session = input.startCare
      ? (
          await careRepository.startCareSession(scoped, {
            id: randomUUID(),
            workspaceId,
            childId: brief.childId,
            userId: actorUserId,
          })
        ).session
      : null;
    // Monotonic: acknowledging an older brief after a newer one leaves the counter where it is.
    const advanced = await handoffsRepository.advanceCursor(scoped, {
      workspaceId,
      childId: brief.childId,
      userId: actorUserId,
      acknowledgedSeq: brief.throughSeqInclusive,
      briefId,
    });
    const acknowledged = await handoffsRepository.markBriefAcknowledged(scoped, {
      workspaceId,
      briefId,
      recipientUserId: actorUserId,
      startedSessionId: session === null ? null : session.id,
    });
    if (acknowledged === null)
      throw ApiHttpError.conflict("This handoff changed since you loaded it");

    await infrastructureRepository.insertAuditLog(scoped, {
      workspaceId,
      childId: brief.childId,
      actorUserId,
      action: "handoff.acknowledged",
      entityType: "handoff_brief",
      entityId: briefId,
      requestId: deps.requestId,
    });
    return {
      brief: await toBriefDto(scoped, deps, {
        brief: acknowledged,
        snapshot,
        journalSeq: child.journalSeq,
      }),
      acknowledgedSeq: advanced.acknowledgedSeq,
      session: await toSessionDto(scoped, deps, session),
    };
  });
}

/**
 * The session a previous acknowledgement opened, if it is still the caller's open one. A session
 * that has since been ended is not reopened by replaying the acknowledgement.
 */
async function startedSession(
  tx: HandoffTransaction,
  startedSessionId: string | null,
  input: { workspaceId: string; childId: string; userId: string },
): Promise<CareSessionRow | null> {
  if (startedSessionId === null) return null;
  const open = await careRepository.findOpenSessionForUser(
    tx,
    input.workspaceId,
    input.childId,
    input.userId,
  );
  return open !== null && open.id === startedSessionId ? open : null;
}

async function toSessionDto(
  tx: HandoffTransaction,
  deps: ServiceDeps,
  session: CareSessionRow | null,
) {
  if (session === null) return null;
  const [dto] = await toCareSessionDtos(tx, deps, [session]);
  return dto ?? null;
}
