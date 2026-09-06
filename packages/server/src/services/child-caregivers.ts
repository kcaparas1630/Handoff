// The roster of people who care for one child, and the grants that authorize them.
import {
  childrenRepository,
  identityRepository,
  infrastructureRepository,
  withTenantTransaction,
} from "@handoff/db";
import type { ChildCaregiverDto, UpdateChildCaregiversRequest } from "@handoff/contracts";
import type { ChildCaregiverRow, HandoffTransaction } from "@handoff/db";
import { authorizeChild } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { inTenantTransaction } from "../lib/in-tenant-transaction";
import { decryptUserProfile } from "../security/profile-fields";
import type { ScopedTransaction } from "../lib/in-tenant-transaction";
import type { ServiceDeps } from "../types/runtime";

interface CaregiverRow {
  grant: ChildCaregiverRow;
  userId: string;
  profileCiphertext: unknown;
}

async function decryptCaregiverNames(
  deps: ServiceDeps,
  rows: CaregiverRow[],
): Promise<ChildCaregiverDto[]> {
  return Promise.all(
    rows.map(async (row) => ({
      userId: row.grant.userId,
      displayName:
        row.profileCiphertext === null
          ? null
          : await decryptUserProfile(deps.keys, row.userId, row.profileCiphertext),
      relationship: row.grant.relationship,
      permission: row.grant.permission,
      status: row.grant.status,
      version: row.grant.version,
    })),
  );
}

async function loadCaregivers(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
): Promise<CaregiverRow[]> {
  const grants = await childrenRepository.listChildCaregivers(tx, workspaceId, childId);
  return Promise.all(
    grants.map(async (grant) => {
      const user = await identityRepository.findUserById(tx, grant.userId);
      return {
        grant,
        userId: grant.userId,
        profileCiphertext: user === null ? null : user.profileCiphertext,
      };
    }),
  );
}

export async function listChildCaregivers({
  deps,
  actorUserId,
  workspaceId,
  childId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
  childId: string;
}): Promise<ChildCaregiverDto[]> {
  const rows = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const authorized = await authorizeChild(tx, { userId: actorUserId, workspaceId, childId });
    // Roster privacy: readers and contributors do not receive the list of other caregivers.
    if (authorized.permission !== "manager") {
      throw ApiHttpError.forbidden("You cannot view this child's caregivers");
    }
    return loadCaregivers(tx, workspaceId, childId);
  });
  // Named-person display authorized through a visible care record (docs/pii-encryption.md).
  return decryptCaregiverNames(deps, rows);
}

export async function updateChildCaregivers({
  deps,
  actorUserId,
  workspaceId,
  childId,
  input,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
  childId: string;
  input: UpdateChildCaregiversRequest;
  /** Supplied by an idempotent route so these grants and the replay record commit together. */
  tx?: ScopedTransaction;
}): Promise<ChildCaregiverDto[]> {
  return inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const authorized = await authorizeChild(scoped, { userId: actorUserId, workspaceId, childId });
    if (authorized.permission !== "manager") {
      throw ApiHttpError.forbidden("You cannot change this child's caregivers");
    }
    if (input.expectedVersion !== undefined && authorized.child.version !== input.expectedVersion) {
      throw ApiHttpError.conflict("This child changed since you loaded it");
    }

    const members = await identityRepository.listMembershipsForWorkspace(scoped, workspaceId);
    for (const grant of input.grants) {
      const member = members.find((row) => row.userId === grant.userId && row.status === "active");
      if (member === undefined) {
        throw ApiHttpError.validationFailed("That person is not an active workspace member", {
          grants: ["Expected an active member of this workspace"],
        });
      }
      // App-role ceiling: an elevated grant to a guardian would never take effect, so it is
      // rejected rather than stored as a misleading record.
      if (member.appRole === "guardian" && grant.permission !== "reader") {
        throw ApiHttpError.validationFailed("A guardian can only be granted read access", {
          grants: ["A guardian may only be granted reader permission"],
        });
      }
      await childrenRepository.upsertChildCaregiver(scoped, {
        workspaceId,
        childId,
        userId: grant.userId,
        relationship: grant.relationship,
        permission: grant.permission,
        grantedByUserId: actorUserId,
      });
      await infrastructureRepository.insertAuditLog(scoped, {
        workspaceId,
        childId,
        actorUserId,
        action: "child_grant.updated",
        entityType: "child_caregiver",
        entityId: grant.userId,
        requestId: deps.requestId,
      });
    }

    for (const userId of input.revokeUserIds ?? []) {
      await childrenRepository.revokeChildCaregiver(scoped, { workspaceId, childId, userId });
      await infrastructureRepository.insertAuditLog(scoped, {
        workspaceId,
        childId,
        actorUserId,
        action: "child_grant.revoked",
        entityType: "child_caregiver",
        entityId: userId,
        requestId: deps.requestId,
      });
    }
    const rows = await loadCaregivers(scoped, workspaceId, childId);
    // Named-person display authorized through a visible care record (docs/pii-encryption.md).
    return decryptCaregiverNames(deps, rows);
  });
}
