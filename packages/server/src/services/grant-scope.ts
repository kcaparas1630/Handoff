// Which children a member may manage. Owners are workspace-wide; everyone else is grant-scoped.
import { childrenRepository } from "@handoff/db";
import { resolveEffectiveChildPermission } from "@handoff/domain";
import type { AppRole } from "@handoff/contracts";
import type { HandoffTransaction } from "@handoff/db";

export interface ManagerScope {
  /** True for workspace owners, who need no per-child grant. */
  everyChild: boolean;
  managedChildIds: Set<string>;
}

export function canManageAnyChild(scope: ManagerScope): boolean {
  return scope.everyChild || scope.managedChildIds.size > 0;
}

export function managesChild(scope: ManagerScope, childId: string): boolean {
  return scope.everyChild || scope.managedChildIds.has(childId);
}

/**
 * Reads each granted child's own grant row. The roster is small and bounded by the caller's
 * grants; a dedicated repository query would replace this loop if a workspace ever grows large.
 */
export async function resolveManagerScope(
  tx: HandoffTransaction,
  input: { workspaceId: string; userId: string; appRole: AppRole },
): Promise<ManagerScope> {
  if (input.appRole === "owner") return { everyChild: true, managedChildIds: new Set() };

  const children = await childrenRepository.listChildrenGrantedToUser(
    tx,
    input.workspaceId,
    input.userId,
  );
  const managedChildIds = new Set<string>();
  for (const child of children) {
    const grant = await childrenRepository.findChildCaregiver(
      tx,
      input.workspaceId,
      child.id,
      input.userId,
    );
    const permission = resolveEffectiveChildPermission({
      appRole: input.appRole,
      membershipStatus: "active",
      grant: grant === null ? null : { permission: grant.permission, status: grant.status },
    });
    if (permission === "manager") managedChildIds.add(child.id);
  }
  return { everyChild: false, managedChildIds };
}
