import type { AppRole, ChildPermission, MembershipStatus } from "@handoff/contracts";

// Grants share the membership active|revoked lifecycle, so they reuse MembershipStatus.
export type ChildGrant = {
  permission: ChildPermission;
  status: MembershipStatus;
};

export type AccessContext = {
  appRole: AppRole;
  membershipStatus: MembershipStatus;
  grant: ChildGrant | null;
};

export type CorrectEventContext = {
  ctx: AccessContext;
  isAuthor: boolean;
};
