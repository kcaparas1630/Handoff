import type { ChildPermission } from "@handoff/contracts";
import type { ChildRow, WorkspaceMembershipRow, WorkspaceRow } from "@handoff/db";
import type { ServiceDeps } from "./runtime";

export interface WorkspaceAuthorization {
  membership: WorkspaceMembershipRow;
  workspace: WorkspaceRow;
}

export interface ChildAuthorization extends WorkspaceAuthorization {
  child: ChildRow;
  /** Effective permission after the app-role ceiling; never null once authorization succeeds. */
  permission: ChildPermission;
}

/**
 * Bootstrap, invitation, and admin operations re-verify membership with Clerk when the local
 * projection is stale; architecture §3 sets a 60 second maximum local verification age.
 */
export interface ProviderFreshness {
  deps: ServiceDeps;
}
