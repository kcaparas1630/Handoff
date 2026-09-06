import {
  AttachmentPermissionError,
  attachmentExtensionForMime,
  describeAttachmentLimitProblem,
  pickAttachment,
  prepareImageForUpload,
  saveAttachmentFile,
  useEnqueueAttachment,
} from "@handoff/mobile";
import type { PickAttachmentSource, PickedAttachment } from "@handoff/mobile";
import { useCallback, useState } from "react";
import { Alert } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import type { AddAttachmentFailure, UseAddAttachment } from "./types/attachment-picker";

const explanations: Readonly<Record<PickAttachmentSource, string>> = {
  library:
    "Handoff attaches photos you choose to a care update. It never reads your library on its own.",
  camera: "Handoff uses the camera only when you tap Take photo, for this one attachment.",
};

export type AddAttachmentContext = {
  captureId: string;
  childId: string;
  workspaceId: string;
  /** Called after the row is queued, so the screen can re-read the outbox immediately. */
  onQueued?: (() => void) | undefined;
};

/**
 * Pick, prepare, and queue one attachment. The upload itself belongs to the durable outbox, so
 * this resolves as soon as the file is in document storage and the row exists.
 */
export function useAddAttachment({
  captureId,
  childId,
  workspaceId,
  onQueued,
}: AddAttachmentContext): UseAddAttachment {
  const enqueue = useEnqueueAttachment();
  const [isWorking, setIsWorking] = useState(false);
  const [failure, setFailure] = useState<AddAttachmentFailure | null>(null);

  const clearFailure = useCallback(() => setFailure(null), []);

  const addAttachment = useCallback(
    async (source: PickAttachmentSource): Promise<void> => {
      setFailure(null);
      setIsWorking(true);
      try {
        const picked = await pickAttachment({
          kind: source === "camera" ? "image" : "any",
          source,
          explainPermission: ({ source: requested }) => confirmPermission(requested),
        });
        if (picked === null) return;
        await queueAttachment(picked, { captureId, childId, workspaceId }, enqueue);
        onQueued?.();
      } catch (error) {
        setFailure(toFailure(error));
      } finally {
        setIsWorking(false);
      }
    },
    [captureId, childId, enqueue, onQueued, workspaceId],
  );

  return { addAttachment, isWorking, failure, clearFailure };
}

/** States the reason in Handoff's own words before the operating system asks anything. */
function confirmPermission(source: PickAttachmentSource): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      source === "camera" ? "Use the camera?" : "Choose a photo or video?",
      explanations[source],
      [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: "Continue", onPress: () => resolve(true) },
      ],
    );
  });
}

async function queueAttachment(
  picked: PickedAttachment,
  context: { captureId: string; childId: string; workspaceId: string },
  enqueue: ReturnType<typeof useEnqueueAttachment>,
): Promise<void> {
  const localId = crypto.randomUUID();

  if (picked.kind === "image") {
    // Resized and re-encoded first, so the size checked here is the size that will be sent.
    const prepared = await prepareImageForUpload(picked.uri, localId);
    throwIfOverLimit({ kind: "image", sizeBytes: prepared.sizeBytes });
    await enqueue({
      ...context,
      localId,
      kind: "image",
      fileUri: prepared.uri,
      mime: prepared.mime,
      sizeBytes: prepared.sizeBytes,
    });
    return;
  }

  // Videos are never re-encoded on the device; an over-limit clip is refused before any upload.
  throwIfOverLimit({ kind: "video", sizeBytes: picked.sizeBytes, durationMs: picked.durationMs });
  const extension = attachmentExtensionForMime(picked.mime);
  if (extension === null) throw new Error("Handoff cannot send this video format.");

  const stored = await saveAttachmentFile(picked.uri, localId, extension);
  await enqueue({
    ...context,
    localId,
    kind: "video",
    fileUri: stored.uri,
    mime: picked.mime,
    sizeBytes: stored.sizeBytes,
    durationMs: picked.durationMs ?? null,
  });
}

function throwIfOverLimit(file: {
  kind: "image" | "video";
  sizeBytes: number;
  durationMs?: number | undefined;
}): void {
  const problem = describeAttachmentLimitProblem(file);
  if (problem !== null) throw new Error(problem);
}

function toFailure(error: unknown): AddAttachmentFailure {
  if (error instanceof AttachmentPermissionError) {
    return { message: error.message, needsSettings: error.isPermanentlyDenied };
  }
  return { message: describeError(error), needsSettings: false };
}
