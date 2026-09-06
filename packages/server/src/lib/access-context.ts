// Rebuilds the domain access context from an already-resolved effective child permission, so the
// permission rules stay in @handoff/domain instead of being re-expressed per service.
import type { AppRole, ChildPermission } from "@handoff/contracts";
import type { AccessContext } from "@handoff/domain";

export function accessContextOf(appRole: AppRole, permission: ChildPermission): AccessContext {
  return {
    appRole,
    membershipStatus: "active",
    grant: { permission, status: "active" },
  };
}
