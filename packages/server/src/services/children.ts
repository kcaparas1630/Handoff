// Child profiles and per-child grants. Profiles are encrypted under the workspace key.
import { randomUUID } from "node:crypto";
import { childrenRepository, infrastructureRepository, withTenantTransaction } from "@handoff/db";
import { canManageChildGrants } from "@handoff/domain";
import type {
  ChildDto,
  ChildPermission,
  CreateChildRequest,
  UpdateChildRequest,
} from "@handoff/contracts";
import type { ChildRow, HandoffTransaction } from "@handoff/db";
import { authorizeChild, authorizeWorkspace } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { inTenantTransaction } from "../lib/in-tenant-transaction";
import { decryptChildProfile, encryptChildProfile } from "../security/profile-fields";
import { canManageAnyChild, resolveManagerScope } from "./grant-scope";
import type { ScopedTransaction } from "../lib/in-tenant-transaction";
import type { ServiceDeps } from "../types/runtime";

/**
 * Birthdates are calendar dates, so "not in the future" is compared against the server's UTC
 * date. A caregiver one day ahead of UTC can be asked to confirm rather than silently corrected.
 */
function assertBirthdateNotFuture(birthdate: string | null, now: Date): void {
  if (birthdate === null) return;
  const today = now.toISOString().slice(0, 10);
  if (birthdate > today) {
    throw ApiHttpError.validationFailed("A birthdate cannot be in the future", {
      birthdate: ["Expected a date that has already happened"],
    });
  }
}

async function toChildDto(
  deps: ServiceDeps,
  child: ChildRow,
  permission: ChildPermission,
): Promise<ChildDto> {
  const profile = await decryptChildProfile(deps.keys, {
    workspaceId: child.workspaceId,
    childId: child.id,
    envelope: child.profileCiphertext,
  });
  return {
    id: child.id,
    workspaceId: child.workspaceId,
    name: profile.name,
    birthdate: profile.birthdate,
    status: child.status,
    permission,
    version: child.version,
  };
}

export async function createChild({
  deps,
  actorUserId,
  workspaceId,
  input,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
  input: CreateChildRequest;
  /** Supplied by an idempotent route so this write and its replay record commit together. */
  tx?: ScopedTransaction;
}): Promise<ChildDto> {
  const childId = randomUUID();
  const child = await inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const actor = await authorizeWorkspace(scoped, { userId: actorUserId, workspaceId });
    const scope = await resolveManagerScope(scoped, {
      workspaceId,
      userId: actorUserId,
      appRole: actor.membership.appRole,
    });
    if (!canManageAnyChild(scope)) {
      throw ApiHttpError.forbidden("You cannot add a child to this workspace");
    }

    const birthdate = input.birthdate ?? null;
    assertBirthdateNotFuture(birthdate, deps.now());
    // `data_keys` is not a tenant table, so resolving the key on its own connection does not
    // widen this transaction.
    const profileCiphertext = await encryptChildProfile(deps.keys, {
      workspaceId,
      childId,
      name: input.name,
      birthdate,
    });

    const inserted = await childrenRepository.insertChild(scoped, {
      id: childId,
      workspaceId,
      profileCiphertext,
      createdByUserId: actorUserId,
    });
    // An owner needs no grant; a manager keeps managing the child they just created.
    if (actor.membership.appRole !== "owner") {
      await childrenRepository.upsertChildCaregiver(scoped, {
        workspaceId,
        childId,
        userId: actorUserId,
        relationship: "caregiver",
        permission: "manager",
        grantedByUserId: actorUserId,
      });
    }
    await infrastructureRepository.insertAuditLog(scoped, {
      workspaceId,
      childId,
      actorUserId,
      action: "child.created",
      entityType: "child",
      entityId: childId,
      requestId: deps.requestId,
    });
    return inserted;
  });

  return toChildDto(deps, child, "manager");
}

export async function getChild({
  deps,
  actorUserId,
  workspaceId,
  childId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
  childId: string;
}): Promise<ChildDto> {
  const authorized = await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
    authorizeChild(tx, { userId: actorUserId, workspaceId, childId }),
  );
  return toChildDto(deps, authorized.child, authorized.permission);
}

export async function listChildren({
  deps,
  actorUserId,
  workspaceId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
}): Promise<ChildDto[]> {
  const rows = await withTenantTransaction(
    deps.db,
    { workspaceId },
    async (tx): Promise<AuthorizedChild[]> => {
      const actor = await authorizeWorkspace(tx, { userId: actorUserId, workspaceId });
      if (actor.membership.appRole === "owner") {
        const children = await childrenRepository.listChildrenForWorkspace(tx, workspaceId);
        return children.map((child) => ({ child, permission: "manager" }));
      }
      return resolveGrantedChildren(tx, {
        workspaceId,
        userId: actorUserId,
        appRole: actor.membership.appRole,
      });
    },
  );
  return Promise.all(rows.map(({ child, permission }) => toChildDto(deps, child, permission)));
}

interface AuthorizedChild {
  child: ChildRow;
  permission: ChildPermission;
}

async function resolveGrantedChildren(
  tx: HandoffTransaction,
  input: { workspaceId: string; userId: string; appRole: "staff" | "caregiver" | "guardian" },
): Promise<AuthorizedChild[]> {
  const children = await childrenRepository.listChildrenGrantedToUser(
    tx,
    input.workspaceId,
    input.userId,
  );
  const rows: AuthorizedChild[] = [];
  for (const child of children) {
    // Guardians stay readers even where a grant says otherwise.
    const permission =
      input.appRole === "guardian" ? "reader" : await grantedPermission(tx, input, child.id);
    rows.push({ child, permission });
  }
  return rows;
}

async function grantedPermission(
  tx: HandoffTransaction,
  input: { workspaceId: string; userId: string },
  childId: string,
): Promise<ChildPermission> {
  const grant = await childrenRepository.findChildCaregiver(
    tx,
    input.workspaceId,
    childId,
    input.userId,
  );
  return grant?.permission ?? "reader";
}

export async function updateChild({
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
  input: UpdateChildRequest;
  /** Supplied by an idempotent route so this write and its replay record commit together. */
  tx?: ScopedTransaction;
}): Promise<ChildDto> {
  return inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const authorized = await authorizeChild(scoped, { userId: actorUserId, workspaceId, childId });
    if (
      !canManageChildGrants(accessContextOf(authorized.membership.appRole, authorized.permission))
    ) {
      throw ApiHttpError.forbidden("You cannot edit this child's profile");
    }

    const current = await decryptChildProfile(deps.keys, {
      workspaceId,
      childId,
      envelope: authorized.child.profileCiphertext,
    });
    const name = input.name ?? current.name;
    const birthdate = input.birthdate === undefined ? current.birthdate : input.birthdate;
    assertBirthdateNotFuture(birthdate, deps.now());
    const profileCiphertext = await encryptChildProfile(deps.keys, {
      workspaceId,
      childId,
      name,
      birthdate,
    });

    const updated = await childrenRepository.updateChildProfile(scoped, {
      workspaceId,
      childId,
      expectedVersion: input.expectedVersion,
      profileCiphertext,
    });
    if (updated === null) throw ApiHttpError.conflict("This child changed since you loaded it");
    return toChildDto(deps, updated, authorized.permission);
  });
}

/** Rebuilds the domain access context from an already-resolved effective permission. */
function accessContextOf(
  appRole: "owner" | "staff" | "caregiver" | "guardian",
  permission: ChildPermission,
) {
  return {
    appRole,
    membershipStatus: "active" as const,
    grant: { permission, status: "active" as const },
  };
}
