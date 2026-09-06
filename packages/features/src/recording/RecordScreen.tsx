import { AUDIO_MAX_DURATION_MS } from "@handoff/contracts";
import {
  deleteRecordingFile,
  useEnqueueRecording,
  useRecordingStore,
  useVoiceRecorder,
} from "@handoff/mobile";
import { Button, RecordButton, Screen, StatusMessage } from "@handoff/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import { useReducedMotion } from "../shared/useReducedMotion";
import { RecordingControls } from "./RecordingControls";
import { TypeInsteadSheet } from "./TypeInsteadSheet";
import { exampleAt, exampleRotationMs } from "./lib/recording-examples";
import { useCaptureContext } from "./useCaptureContext";
import type { RecordScreenProps } from "./types/recording";

const permissionExplanation =
  "Handoff needs the microphone to record this update. It records only while you are on this " +
  "screen and only after you tap Record.";

// Recorded with the capture so a later reader knows the language the update was spoken in.
const deviceLocale = Intl.DateTimeFormat().resolvedOptions().locale;

export function RecordScreen({ childId, onReview, onCancel }: RecordScreenProps) {
  const context = useCaptureContext(childId);
  const isReducedMotion = useReducedMotion();
  const enqueueRecording = useEnqueueRecording();
  const startRecording = useRecordingStore((state) => state.startRecording);
  const clearActiveRecording = useRecordingStore((state) => state.clearActiveRecording);

  const [exampleIndex, setExampleIndex] = useState(0);
  const [localId, setLocalId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasExplainedPermission, setHasExplainedPermission] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  // Guards the hand-off so a re-render cannot enqueue the same recording twice.
  const enqueuedId = useRef<string | null>(null);

  const onLimitReached = useCallback(() => {
    setNotice(`Recording stopped at ${Math.round(AUDIO_MAX_DURATION_MS / 1000)} seconds.`);
  }, []);
  const recorder = useVoiceRecorder({ maxDurationMs: AUDIO_MAX_DURATION_MS, onLimitReached });

  // A static example under reduced motion; the rotation is decoration, never the instruction.
  useEffect(() => {
    if (isReducedMotion || recorder.status === "recording") return;
    const timer = setInterval(() => setExampleIndex((index) => index + 1), exampleRotationMs);
    return () => clearInterval(timer);
  }, [isReducedMotion, recorder.status]);

  const { saved } = recorder;
  const { timezone, workspaceId, careSessionId } = context;

  // Whichever way the recording ended, the file is handed to the outbox exactly once.
  useEffect(() => {
    if (saved === null || localId === null || workspaceId === null || timezone === null) return;
    if (enqueuedId.current === localId) return;
    enqueuedId.current = localId;
    void enqueueRecording({
      localId,
      workspaceId,
      childId,
      capturedAt: new Date().toISOString(),
      timezone,
      locale: deviceLocale,
      careSessionId: careSessionId ?? null,
      recording: saved,
    })
      .then(() => {
        clearActiveRecording();
        onReview({ kind: "local", localId });
      })
      .catch((error: unknown) => {
        // Nothing references the file now, so it is removed rather than left on the phone.
        deleteRecordingFile(saved.uri);
        setLocalId(null);
        clearActiveRecording();
        setSaveError(describeError(error));
      });
  }, [
    careSessionId,
    childId,
    clearActiveRecording,
    enqueueRecording,
    localId,
    onReview,
    saved,
    timezone,
    workspaceId,
  ]);

  if (context.isPending) {
    return (
      <Screen>
        <StatusMessage tone="info" message="Loading this child…" />
      </Screen>
    );
  }

  const childName = context.childName;
  if (context.error !== null || childName === null) {
    return (
      <Screen>
        <StatusMessage tone="error" message={describeError(context.error)} />
        <Button label="Try again" onPress={context.refetch} />
        <Button label="Back" variant="quiet" onPress={onCancel} />
      </Screen>
    );
  }

  const isRecording = recorder.status === "recording";
  const isStopping = recorder.status === "stopping";
  const isDenied = recorder.status === "permission-denied" || recorder.permission === "denied";
  const canRecord = context.canContribute && timezone !== null && workspaceId !== null;

  function handleRecordPress(): void {
    setNotice(null);
    setSaveError(null);
    // The explanation comes before the system prompt the first time, not instead of it.
    if (recorder.permission === "undetermined" && !hasExplainedPermission) {
      setHasExplainedPermission(true);
      return;
    }
    const nextLocalId = crypto.randomUUID();
    setLocalId(nextLocalId);
    startRecording({ localId: nextLocalId, childId });
    void recorder.start(nextLocalId);
  }

  function handleCancel(): void {
    setLocalId(null);
    clearActiveRecording();
    void recorder.cancel().then(onCancel);
  }

  return (
    <Screen scroll testID="record-screen">
      <View className="gap-xs">
        <Text className="text-2xl font-semibold text-primary dark:text-primary-dark">
          Record an update
        </Text>
        <Text className="text-base text-muted dark:text-muted-dark">for {childName}</Text>
      </View>

      {notice === null ? null : <StatusMessage tone="info" message={notice} />}
      {saveError === null ? null : <StatusMessage tone="error" message={saveError} />}
      {recorder.errorMessage === null ? null : (
        <StatusMessage tone="error" message={recorder.errorMessage} />
      )}

      {recorder.status === "saved" && localId !== null ? (
        <StatusMessage tone="success" message="Saved on this phone. Nothing is shared yet." />
      ) : null}

      {isRecording || isStopping ? (
        <RecordingControls
          childName={childName}
          elapsedMs={recorder.elapsedMs}
          maxDurationMs={AUDIO_MAX_DURATION_MS}
          meteringLevel={recorder.meteringLevel}
          isBusy={isStopping}
          onStop={() => void recorder.stop()}
          onCancel={handleCancel}
        />
      ) : (
        <>
          {hasExplainedPermission && recorder.permission === "undetermined" ? (
            <StatusMessage tone="info" message={permissionExplanation} />
          ) : null}

          <RecordButton
            state={canRecord && !isDenied ? "idle" : "disabled"}
            onPress={handleRecordPress}
            hintText={`Say a few things. Review them together. For example: “${exampleAt(exampleIndex)}”`}
            disabledReason={disabledReason(context.canContribute, timezone, isDenied)}
            isReducedMotion={isReducedMotion}
            testID="record-start"
          />
        </>
      )}

      {isDenied ? (
        <View className="gap-md">
          <StatusMessage
            tone="warning"
            message="The microphone is turned off for Handoff. Typing an update works just as well."
          />
          <Button
            label="Open settings"
            variant="secondary"
            onPress={() => void Linking.openSettings()}
            testID="record-open-settings"
          />
        </View>
      ) : null}

      {isRecording || isStopping ? null : (
        <>
          <Button
            label="Type instead"
            variant="secondary"
            onPress={() => setIsTyping(true)}
            isDisabled={!canRecord}
            testID="record-type-instead"
          />
          <Button label="Back" variant="quiet" onPress={onCancel} />
        </>
      )}

      {isTyping && timezone !== null ? (
        <TypeInsteadSheet
          childId={childId}
          childName={childName}
          timezone={timezone}
          careSessionId={careSessionId}
          onCreated={(captureId) => {
            setIsTyping(false);
            onReview({ kind: "capture", captureId });
          }}
          onClose={() => setIsTyping(false)}
        />
      ) : null}
    </Screen>
  );
}

function disabledReason(
  canContribute: boolean,
  timezone: string | null,
  isDenied: boolean,
): string | undefined {
  if (isDenied) return "Microphone access is off. Use Type instead, or turn it on in settings.";
  if (!canContribute) return "You can read this child's care but not add updates.";
  if (timezone === null) return "Loading the workspace time zone before a recording can be saved.";
  return undefined;
}
