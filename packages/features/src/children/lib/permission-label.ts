import type { ChildPermission } from "@handoff/contracts";

// Plain descriptions of data-contract.md section 7. The server still decides every request; these
// strings only explain what the caller's own permission field already says.
const permissionLabels: Record<ChildPermission, string> = {
  reader: "You can read this child's care",
  contributor: "You can record care for this child",
  manager: "You manage this child's caregivers",
};

export function describeChildPermission(permission: ChildPermission): string {
  return permissionLabels[permission];
}
