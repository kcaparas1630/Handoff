// Declared care sessions. Several caregivers may be active at once; every action here affects
// the caller's own session only (data contract §4).
import { randomUUID } from "node:crypto";
import { careRepository, identityRepository, withTenantTransaction } from "@handoff/db";
import { canStartOwnCareSession } from "@handoff/domain";
import type { CareSessionDto } from "@handoff/contracts";
import type { CareSessionRow, HandoffTransaction } from "@handoff/db";
import { authorizeChild } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { accessContextOf } from "../lib/access-context";
import { inTenantTransaction } from "../lib/in-tenant-transaction";
import { decryptUserProfile } from "../security/profile-fields";
import { resolveChildWorkspace } from "./workspace-lookup";
import type { ScopedTransaction } from "../lib/in-tenant-transaction";
import type { ServiceDeps } from "../types/runtime";

/**
 * Named-person displays authorized through visible care records: a reader of this child may see
 * who says they are caring for them. Sessions are few, so the roster is decrypted per session.
 */
export async function toCareSessionDtos(
  tx: HandoffTransaction,
  deps: ServiceDeps,
  sessions: readonly CareSessionRow[],
): Promise<CareSessionDto[]> {
  const users = await Promise.all(
    [...new Set(sessions.map((session) => session.userId))].map(async (userId) => {
      const user = await identityRepository.findUserById(tx, userId);
      const displayName =
        user === null ? null : await decryptUserProfile(deps.keys, user.id, user.profileCiphertext);
      return [userId, displayName] as const;
    }),
  );
  const names = new Map(users);
  return sessions.map((session) => ({
    id: session.id,
    childId: session.childId,
    workspaceId: session.workspaceId,
    userId: session.userId,
    displayName: names.get(session.userId) ?? null,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt === null ? null : session.endedAt.toISOString(),
    endReason: session.endReason,
    version: session.version,
  }));
}

export async function listCare({
  deps,
  actorUserId,
  childId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  childId: string;
}): Promise<CareSessionDto[]> {
  const workspaceId = await resolveChildWorkspace({ deps, actorUserId, childId });
  return withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    await authorizeChild(tx, { userId: actorUserId, workspaceId, childId });
    const sessions = await careRepository.listActiveSessionsForChild(tx, workspaceId, childId);
    return toCareSessionDtos(tx, deps, sessions);
  });
}

/**
 * Opening a session is self-reported care, so any caregiver with read access may do it, and it
 * grants nothing further. A double tap resolves to the session that is already open.
 */
export async function startCare({
  deps,
  actorUserId,
  childId,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  childId: string;
  tx?: ScopedTransaction;
}): Promise<CareSessionDto> {
  const workspaceId =
    tx?.workspaceId ?? (await resolveChildWorkspace({ deps, actorUserId, childId }));

  return inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const authorization = await authorizeChild(scoped, {
      userId: actorUserId,
      workspaceId,
      childId,
    });
    const context = accessContextOf(authorization.membership.appRole, authorization.permission);
    if (!canStartOwnCareSession(context)) {
      throw ApiHttpError.forbidden("You cannot start care for this child");
    }
    const started = await careRepository.startCareSession(scoped, {
      id: randomUUID(),
      workspaceId,
      childId,
      userId: actorUserId,
    });
    const [dto] = await toCareSessionDtos(scoped, deps, [started.session]);
    if (dto === undefined) throw new Error("startCare produced no session");
    return dto;
  });
}

export async function endCare({
  deps,
  actorUserId,
  childId,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  childId: string;
  tx?: ScopedTransaction;
}): Promise<CareSessionDto> {
  const workspaceId =
    tx?.workspaceId ?? (await resolveChildWorkspace({ deps, actorUserId, childId }));

  return inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    await authorizeChild(scoped, { userId: actorUserId, workspaceId, childId });
    // Ends the caller's own session and nobody else's; with none open there is nothing to end.
    const ended = await careRepository.endCareSession(scoped, {
      workspaceId,
      childId,
      userId: actorUserId,
      endReason: "user_ended",
    });
    if (ended === null) throw ApiHttpError.notFound("You have no open care session here");
    const [dto] = await toCareSessionDtos(scoped, deps, [ended]);
    if (dto === undefined) throw new Error("endCare produced no session");
    return dto;
  });
}
