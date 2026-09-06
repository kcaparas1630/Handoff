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
export {
  isCompletedCareCandidate,
  isCompletedCareFact,
  validateEventSemantics,
} from "./lib/event-rules";
export { resolveEventTime } from "./lib/resolve-event-time";
export { renderBrief } from "./lib/brief-renderer";
export { renderAgeLabel, renderFactText } from "./lib/fact-text";
export {
  formatWallClock,
  formatWallDate,
  getZonedParts,
  shiftWallDay,
  wallDayDifference,
  zonedTimeToInstant,
} from "./lib/zoned-time";

export type { AccessContext, ChildGrant, CorrectEventContext } from "./types/permissions";
export type {
  CandidateFact,
  EventFieldError,
  EventSemanticsInput,
  EventSemanticsResult,
} from "./types/events";
export type {
  Meridiem,
  ResolveEventTimeInput,
  ResolvedEventTime,
  SpokenTime,
  TimeAmbiguity,
} from "./types/event-time";
export type {
  BriefBoundary,
  FactTextFields,
  LatestKnownFact,
  LatestKnownFacts,
  RenderBriefInput,
  RevisionForBrief,
} from "./types/brief";
export type { WallClock, ZonedResolution } from "./types/zoned-time";
