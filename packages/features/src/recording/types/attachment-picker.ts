import type { PickAttachmentSource } from "@handoff/mobile";

export type AttachmentPickerProps = {
  /** The capture the file rides on; null while it has not been allocated, which disables adding. */
  captureId: string | null;
  childId: string;
  workspaceId: string;
  /**
   * Attachments the server has already published for this capture, derived from its events'
   * `readyAssetIds`. Counted against the same three-per-capture limit.
   */
  serverAttachmentCount: number;
  className?: string | undefined;
  testID?: string | undefined;
};

/** What went wrong on the last attempt, in one sentence the caregiver can act on. */
export type AddAttachmentFailure = {
  message: string;
  /** True when only the system settings screen can grant what the pick needed. */
  needsSettings: boolean;
};

export type UseAddAttachment = {
  addAttachment: (source: PickAttachmentSource) => Promise<void>;
  isWorking: boolean;
  failure: AddAttachmentFailure | null;
  clearFailure: () => void;
};
