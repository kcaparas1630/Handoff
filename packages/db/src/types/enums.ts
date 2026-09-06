// Row-level enumerations shared by several row types. Transport enums live in @handoff/contracts.
export type AppRole = "owner" | "staff" | "caregiver" | "guardian";

export type MembershipStatus = "active" | "revoked";

export type ChildStatus = "active" | "archived" | "deleting" | "deleted";

export type CaregiverRelationship = "parent" | "relative" | "caregiver" | "other";

export type ChildPermission = "reader" | "contributor" | "manager";

export type InvitationStatus =
  "pending_send" | "sent" | "accepted" | "revoked" | "expired" | "reconcile_needed";

export type CaptureInputKind = "audio" | "text" | "manual";

export type CaptureStatus =
  | "awaiting_upload"
  | "queued"
  | "processing"
  | "needs_review"
  | "confirmed"
  | "failed"
  | "cancelled";

export type EventKind = "feed" | "diaper" | "sleep" | "milestone" | "note";

export type TimePrecision = "exact" | "approximate" | "unknown";

export type EventStatus = "active" | "deleted";

export type RevisionOperation = "created" | "corrected" | "deleted" | "media_updated";

export type CareEndReason = "user_ended" | "membership_revoked" | "child_archived";

export type BriefStatus = "ready" | "invalidated" | "redacted";
