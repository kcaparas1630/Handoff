// architecture.md section 7: every key carries the signed-in user, plus the workspace or child it
// belongs to, so switching account or workspace can never read another scope's cached data.

// A hook still needs a key while an id is unresolved; this placeholder keeps those entries from
// colliding with a real user, workspace, or child.
const unknownScope = "unresolved";

function scope(id: string | null): string {
  return id ?? unknownScope;
}

export const queryKeys = {
  bootstrap: (userId: string | null) => ["bootstrap", scope(userId)] as const,
  children: (userId: string | null, workspaceId: string | null) =>
    ["children", scope(userId), scope(workspaceId)] as const,
  child: (userId: string | null, childId: string | null) =>
    ["child", scope(userId), scope(childId)] as const,
  invitations: (userId: string | null, workspaceId: string | null) =>
    ["invitations", scope(userId), scope(workspaceId)] as const,
  caregivers: (userId: string | null, childId: string | null) =>
    ["caregivers", scope(userId), scope(childId)] as const,
  overview: (userId: string | null, childId: string | null) =>
    ["overview", scope(userId), scope(childId)] as const,
  // A kind filter is appended by the hook, so invalidating this prefix refreshes every filter.
  events: (userId: string | null, childId: string | null) =>
    ["events", scope(userId), scope(childId)] as const,
  capture: (userId: string | null, captureId: string | null) =>
    ["capture", scope(userId), scope(captureId)] as const,
  care: (userId: string | null, childId: string | null) =>
    ["care", scope(userId), scope(childId)] as const,
  brief: (userId: string | null, briefId: string | null) =>
    ["brief", scope(userId), scope(briefId)] as const,
  // Signed read URLs expire in about a minute, so this entry is short-lived and never persisted.
  asset: (userId: string | null, assetId: string | null) =>
    ["asset", scope(userId), scope(assetId)] as const,
};
