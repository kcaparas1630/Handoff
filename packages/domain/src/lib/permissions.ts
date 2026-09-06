import type { ChildPermission } from "@handoff/contracts";
import type { AccessContext, CorrectEventContext } from "../types/permissions";

// data-contract.md §7: every action needs active membership; owners are workspace-wide,
// everyone else needs an active child grant.
export function resolveEffectiveChildPermission(ctx: AccessContext): ChildPermission | null {
  if (ctx.membershipStatus !== "active") return null;
  if (ctx.appRole === "owner") return "manager";
  if (ctx.grant === null || ctx.grant.status !== "active") return null;
  // App-role ceiling: a daycare guardian stays read-only even if an erroneous contributor grant exists.
  if (ctx.appRole === "guardian") return "reader";
  return ctx.grant.permission;
}

export function canReadChild(ctx: AccessContext): boolean {
  return resolveEffectiveChildPermission(ctx) !== null;
}

export function canCreateCapture(ctx: AccessContext): boolean {
  const permission = resolveEffectiveChildPermission(ctx);
  return permission === "contributor" || permission === "manager";
}

export function canCorrectEvent({ ctx, isAuthor }: CorrectEventContext): boolean {
  const permission = resolveEffectiveChildPermission(ctx);
  if (permission === "manager") return true;
  if (permission === "contributor") return isAuthor;
  return false;
}

export function canReadOtherAuthorDraft(ctx: AccessContext): boolean {
  return ctx.appRole === "owner" && resolveEffectiveChildPermission(ctx) !== null;
}

export function canManageChildGrants(ctx: AccessContext): boolean {
  return resolveEffectiveChildPermission(ctx) === "manager";
}

// Managers may only invite within their granted scope; the caller checks that scope per child.
export function canInviteMembers(ctx: AccessContext): boolean {
  return resolveEffectiveChildPermission(ctx) === "manager";
}

export function canDeleteChild(ctx: AccessContext): boolean {
  return ctx.appRole === "owner" && resolveEffectiveChildPermission(ctx) !== null;
}

// Readers may self-report care; doing so does not upgrade their journal permissions.
export function canStartOwnCareSession(ctx: AccessContext): boolean {
  return resolveEffectiveChildPermission(ctx) !== null;
}
