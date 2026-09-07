export interface ChildScope {
  workspaceId: string;
  childId: string;
}

/**
 * Rows still referencing a purged child. A completed purge leaves zeroes everywhere except
 * `redactedBriefs`, which is the retained acknowledgement trail, and `liveChildRows`, which is
 * zero once the child row itself reaches its `deleted` tombstone.
 */
export interface PurgeCounts {
  captures: number;
  events: number;
  eventRevisions: number;
  mediaAssets: number;
  careSessions: number;
  handoffCursors: number;
  childCaregivers: number;
  invitationChildGrants: number;
  jobs: number;
  unredactedBriefs: number;
  redactedBriefs: number;
  liveChildRows: number;
}
