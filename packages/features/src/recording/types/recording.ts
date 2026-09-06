import type { EventDto } from "@handoff/contracts";

/**
 * What the review screen was opened with. A recording that has not reached the API yet is only
 * known by its local id; the outbox resolves it to a capture id once the server allocates one.
 */
export type ReviewTarget =
  { kind: "capture"; captureId: string } | { kind: "local"; localId: string };

export type RecordScreenProps = {
  childId: string;
  /** Called after Stop or after a typed entry; never automatically on mount. */
  onReview: (target: ReviewTarget) => void;
  onCancel: () => void;
};

export type ReviewCaptureScreenProps = {
  target: ReviewTarget;
  onSaved: (events: readonly EventDto[]) => void;
  /** Manual entry stays one tap away when a recording cannot be processed. */
  onEnterManually: (childId: string) => void;
  onClose: () => void;
};

export type TypeInsteadSheetProps = {
  childId: string;
  childName: string;
  timezone: string;
  careSessionId?: string | undefined;
  onCreated: (captureId: string) => void;
  onClose: () => void;
};
