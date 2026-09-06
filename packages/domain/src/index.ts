// Pure permissions, time resolution, event rules, and the brief renderer.

export {
  canCorrectEvent,
  canCreateCapture,
  canDeleteChild,
  canInviteMembers,
  canManageChildGrants,
  canReadChild,
  canReadOtherAuthorDraft,
  canStartOwnCareSession,
  resolveEffectiveChildPermission,
} from "./lib/permissions";

export type { AccessContext, ChildGrant, CorrectEventContext } from "./types/permissions";
