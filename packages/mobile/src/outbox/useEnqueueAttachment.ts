import { useApiUserId } from "@handoff/api-client";
import type { AttachmentKind } from "@handoff/contracts";
import { useCallback } from "react";

import { useRecordingStore } from "../state/recording-store";
import { insertOutboxAttachment } from "./attachment-database";
import { openOutbox } from "./database";

export type EnqueueAttachmentInput = {
  /** The id the prepared file was stored under, so the row and the file always agree. */
  localId: string;
  workspaceId: string;
  childId: string;
  /** The capture this attachment rides on; it must already exist on the server. */
  captureId: string;
  kind: AttachmentKind;
  fileUri: string;
  mime: string;
  sizeBytes: number;
  durationMs?: number | null;
};

/**
 * Hands a prepared attachment to the durable outbox. Nothing is sent here: the picker's job ends
 * at the stored file, and the outbox owns every upload attempt from this point.
 */
export function useEnqueueAttachment(): (input: EnqueueAttachmentInput) => Promise<void> {
  const clerkUserId = useApiUserId();
  const requestOutboxSync = useRecordingStore((state) => state.requestOutboxSync);

  return useCallback(
    async (input: EnqueueAttachmentInput): Promise<void> => {
      if (clerkUserId === null) throw new Error("Sign in again before adding this file.");
      const db = await openOutbox();
      await insertOutboxAttachment(db, { ...input, clerkUserId });
      requestOutboxSync();
    },
    [clerkUserId, requestOutboxSync],
  );
}
