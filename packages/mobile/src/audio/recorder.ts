import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import type { RecordingOptions, RecordingStatus } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { normaliseMeteringLevel } from "./lib/metering-level";
import { deleteRecordingFile, persistRecording } from "./recording-storage";
import type {
  MicrophonePermission,
  RecorderStatus,
  RecordingEndReason,
  SavedRecording,
  UseVoiceRecorderOptions,
  VoiceRecorder,
} from "./types/recorder";

// Module scope on purpose: useAudioRecorder rebuilds the native recorder whenever the serialised
// options change, so a fresh object each render would discard an in-progress recording.
const recordingOptions: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

const statusPollMs = 250;

/**
 * A thin adapter over expo-audio. It controls device audio and writes local files, and knows
 * nothing about captures or uploads: that boundary belongs to the outbox.
 */
export function useVoiceRecorder(options: UseVoiceRecorderOptions): VoiceRecorder {
  const { maxDurationMs } = options;

  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [permission, setPermission] = useState<MicrophonePermission>("unknown");
  const [saved, setSaved] = useState<SavedRecording | null>(null);
  const [endReason, setEndReason] = useState<RecordingEndReason | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [finalDurationMs, setFinalDurationMs] = useState(0);

  const statusRef = useRef<RecorderStatus>("idle");
  const localIdRef = useRef<string | null>(null);
  const limitCallbackRef = useRef(options.onLimitReached);
  const interruptionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    limitCallbackRef.current = options.onLimitReached;
  }, [options.onLimitReached]);

  const moveTo = useCallback((next: RecorderStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  // expo-audio subscribes once per recorder, so the listener reads the current handler by ref.
  const handleRecordingStatus = useCallback((update: RecordingStatus) => {
    // A phone call or a media-services reset ends the recording without a Stop tap.
    if (update.hasError || update.mediaServicesDidReset === true) {
      interruptionRef.current?.();
    }
  }, []);

  const recorder = useAudioRecorder(recordingOptions, handleRecordingStatus);
  const recorderState = useAudioRecorderState(recorder, statusPollMs);

  useEffect(() => {
    let isMounted = true;
    void getRecordingPermissionsAsync().then((response) => {
      if (!isMounted) return;
      setPermission(toPermission(response.granted, response.canAskAgain));
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Keeps the stopped file rather than discarding it: a partial update is still the caregiver's.
  const finish = useCallback(
    async (reason: RecordingEndReason): Promise<SavedRecording | null> => {
      if (statusRef.current !== "recording") return null;
      moveTo("stopping");
      const captureLocalId = localIdRef.current;
      const durationMs = recorder.getStatus().durationMillis;
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (uri === null || captureLocalId === null || durationMs <= 0) {
          throw new Error("This recording came back empty, so nothing was saved.");
        }
        const file = await persistRecording(uri, captureLocalId);
        const result: SavedRecording = { ...file, durationMs };
        setFinalDurationMs(durationMs);
        setSaved(result);
        setEndReason(reason);
        setErrorMessage(null);
        moveTo("saved");
        return result;
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "The recording could not be kept.",
        );
        setSaved(null);
        setEndReason(reason);
        moveTo("idle");
        return null;
      }
    },
    [moveTo, recorder],
  );

  useEffect(() => {
    interruptionRef.current = () => {
      void finish("interrupted");
    };
  }, [finish]);

  // The 60 second product limit is enforced here rather than through the native forDuration
  // option, so the same stop path runs and the partial file still reaches document storage.
  useEffect(() => {
    if (status !== "recording" || recorderState.durationMillis < maxDurationMs) return;
    limitCallbackRef.current?.();
    void finish("limit-reached");
  }, [finish, maxDurationMs, recorderState.durationMillis, status]);

  // Backgrounding suspends the microphone; stopping keeps what was captured up to that moment.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" || statusRef.current !== "recording") return;
      void finish("interrupted");
    });
    return () => subscription.remove();
  }, [finish]);

  const start = useCallback(
    async (captureLocalId: string): Promise<void> => {
      if (statusRef.current === "recording" || statusRef.current === "stopping") return;
      setSaved(null);
      setEndReason(null);
      setErrorMessage(null);
      setFinalDurationMs(0);
      moveTo("requesting-permission");

      const response = await requestRecordingPermissionsAsync();
      setPermission(toPermission(response.granted, response.canAskAgain));
      if (!response.granted) {
        moveTo("permission-denied");
        return;
      }

      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync(recordingOptions);
        localIdRef.current = captureLocalId;
        recorder.record();
        moveTo("recording");
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "The microphone could not be started.",
        );
        moveTo("idle");
      }
    },
    [moveTo, recorder],
  );

  const stop = useCallback(() => finish("stopped"), [finish]);

  const cancel = useCallback(async (): Promise<void> => {
    if (statusRef.current === "recording") {
      try {
        await recorder.stop();
      } catch {
        // Already stopped by the system; the temporary file is still removed below.
      }
    }
    const uri = recorder.uri;
    if (uri !== null) deleteRecordingFile(uri);
    localIdRef.current = null;
    setSaved(null);
    setEndReason(null);
    setErrorMessage(null);
    setFinalDurationMs(0);
    moveTo("idle");
  }, [moveTo, recorder]);

  return {
    status,
    permission,
    elapsedMs: status === "recording" ? recorderState.durationMillis : finalDurationMs,
    meteringLevel: status === "recording" ? normaliseMeteringLevel(recorderState.metering) : null,
    saved,
    endReason,
    errorMessage,
    start,
    stop,
    cancel,
  };
}

function toPermission(granted: boolean, canAskAgain: boolean): MicrophonePermission {
  if (granted) return "granted";
  return canAskAgain ? "undetermined" : "denied";
}
