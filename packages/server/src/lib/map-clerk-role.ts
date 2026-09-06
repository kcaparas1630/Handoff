// Server-owned role mapping. A client-supplied role string is never an input here.
import type { AppRole } from "@handoff/contracts";
import type { MapClerkRoleInput } from "../types/clerk";

const CLERK_ADMIN_ROLE = "org:admin";
const CLERK_MEMBER_ROLE = "org:member";

/**
 * Clerk administrators are workspace owners. The configured custom guardian role is read-only.
 * Any other member role takes the stored invitation's intended role, defaulting to `caregiver`;
 * an intent can never promote a plain member to owner.
 */
export function mapClerkRoleToAppRole({
  clerkRole,
  intendedAppRole,
  guardianRoleKey,
}: MapClerkRoleInput): AppRole {
  if (clerkRole === CLERK_ADMIN_ROLE) return "owner";
  if (clerkRole === guardianRoleKey) return "guardian";
  if (intendedAppRole === null || intendedAppRole === "owner") return "caregiver";
  return intendedAppRole;
}

/** The provider role an invitation is sent with, derived from the intended app role. */
export function mapAppRoleToClerkRole({
  appRole,
  guardianRoleKey,
}: {
  appRole: AppRole;
  guardianRoleKey: string;
}): string {
  if (appRole === "owner") return CLERK_ADMIN_ROLE;
  if (appRole === "guardian") return guardianRoleKey;
  return CLERK_MEMBER_ROLE;
}

export function isClerkOrgAdmin(clerkRole: string): boolean {
  return clerkRole === CLERK_ADMIN_ROLE;
}
