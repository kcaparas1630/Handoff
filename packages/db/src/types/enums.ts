// Row-level enumerations shared by several row types. Transport enums live in @handoff/contracts.
export type AppRole = "owner" | "staff" | "caregiver" | "guardian";

export type MembershipStatus = "active" | "revoked";

export type ChildStatus = "active" | "archived" | "deleting" | "deleted";

export type CaregiverRelationship = "parent" | "relative" | "caregiver" | "other";

export type ChildPermission = "reader" | "contributor" | "manager";

export type InvitationStatus =
  "pending_send" | "sent" | "accepted" | "revoked" | "expired" | "reconcile_needed";
