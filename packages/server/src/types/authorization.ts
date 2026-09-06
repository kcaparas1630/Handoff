import type { ChildPermission } from "@handoff/contracts";
import type { ChildRow, WorkspaceMembershipRow, WorkspaceRow } from "@handoff/db";

export interface WorkspaceAuthorization {
  membership: WorkspaceMembershipRow;
  workspace: WorkspaceRow;
}

export interface ChildAuthorization extends WorkspaceAuthorization {
  child: ChildRow;
  /** Effective permission after the app-role ceiling; never null once authorization succeeds. */
  permission: ChildPermission;
}
