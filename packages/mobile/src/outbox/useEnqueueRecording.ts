import { useApiUserId } from "@handoff/api-client";
import { useCallback } from "react";

import { useRecordingStore } from "../state/recording-store";
import { insertOutboxCapture, openOutbox } from "./database";
import type { SavedRecording } from "../audio/types/recorder";

export type EnqueueRecordingInput = {
  /** The id the file was recorded under, so the row and the file always agree. */
  localId: string;
  workspaceId: string;
  childId: string;
  /** When the recording was made, which is not when the care happened. */
  capturedAt: string;
  timezone: string;
  locale: string;
  careSessionId?: string | null;
  recording: SavedRecording;
};

/**
 * Hands a stopped recording to the durable outbox. Nothing is sent here: the recorder's job ends
 * at the local file, and the outbox owns every upload attempt from this point.
 */
export function useEnqueueRecording(): (input: EnqueueRecordingInput) => Promise<void> {
  const clerkUserId = useApiUserId();
  const requestOutboxSync = useRecordingStore((state) => state.requestOutboxSync);

  return useCallback(
    async (input: EnqueueRecordingInput): Promise<void> => {
      if (clerkUserId === null) throw new Error("Sign in again before saving this recording.");
      const db = await openOutbox();
      await insertOutboxCapture(db, {
        localId: input.localId,
        clerkUserId,
        workspaceId: input.workspaceId,
        childId: input.childId,
        // Distinct from the local id: this one is the server's create idempotency key.
        clientCaptureId: crypto.randomUUID(),
        fileUri: input.recording.uri,
        mime: input.recording.mime,
        sizeBytes: input.recording.sizeBytes,
        durationMs: input.recording.durationMs,
        capturedAt: input.capturedAt,
        timezone: input.timezone,
        locale: input.locale,
        careSessionId: input.careSessionId ?? null,
      });
      requestOutboxSync();
    },
    [clerkUserId, requestOutboxSync],
  );
}
