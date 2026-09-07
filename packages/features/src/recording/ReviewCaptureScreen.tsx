import {
  useCapture,
  useConfirmCapture,
  useRetryCapture,
  useUpdateCaptureDraft,
} from "@handoff/api-client";
import type { DraftCandidate, EventDto } from "@handoff/contracts";
import {
  openOutbox,
  recordClientMetric,
  retryOutboxCapture,
  useOutboxCapture,
  useRecordingStore,
} from "@handoff/mobile";
import { Button, Screen, StatusMessage } from "@handoff/ui";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import { AttachmentPicker } from "./AttachmentPicker";
import { CaptureFailureActions } from "./CaptureFailureActions";
import { CaptureProgressSteps } from "./CaptureProgressSteps";
import { DraftCandidateRow } from "./DraftCandidateRow";
import { EditCandidateSheet } from "./EditCandidateSheet";
import { SavedCaptureTransition } from "./SavedCaptureTransition";
import { TranscriptSection } from "./TranscriptSection";
import { canRetryCaptureError, describeCaptureError } from "./lib/describe-capture-error";
import { describeCaptureStatus } from "./lib/describe-capture-status";
import type { ReviewCaptureScreenProps } from "./types/recording";

export function ReviewCaptureScreen({
  target,
  onSaved,
  onEnterManually,
  onClose,
}: ReviewCaptureScreenProps) {
  const localId = target.kind === "local" ? target.localId : null;
  const outbox = useOutboxCapture(localId);
  // Held once resolved: the outbox row is deleted as soon as the server settles the capture, and
  // the review screen must keep working after that.
  const [resolvedCaptureId, setResolvedCaptureId] = useState(
    target.kind === "capture" ? target.captureId : null,
  );
  const rowCaptureId = outbox.row?.captureId ?? null;
  useEffect(() => {
    if (rowCaptureId !== null) setResolvedCaptureId(rowCaptureId);
  }, [rowCaptureId]);
  const captureId = resolvedCaptureId;

  const capture = useCapture(captureId, { pollWhileProcessing: true });
  const updateDraft = useUpdateCaptureDraft(captureId ?? "");
  const confirm = useConfirmCapture(captureId ?? "");
  const retry = useRetryCapture(captureId ?? "");
  const setReviewCaptureId = useRecordingStore((state) => state.setReviewCaptureId);
  const requestOutboxSync = useRecordingStore((state) => state.requestOutboxSync);

  const [candidates, setCandidates] = useState<DraftCandidate[] | null>(null);
  // Counted once per capture: polling re-renders this screen every couple of seconds.
  const countedReadyId = useRef<string | null>(null);
  const [savedEvents, setSavedEvents] = useState<readonly EventDto[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const seededVersion = useRef<number | null>(null);

  useEffect(() => {
    setReviewCaptureId(captureId);
    return () => setReviewCaptureId(null);
  }, [captureId, setReviewCaptureId]);

  // The server draft is the starting point; later edits stay local until they are saved back.
  const draft = capture.data?.draft ?? null;
  const draftVersion = capture.data?.draftVersion ?? null;
  useEffect(() => {
    if (draft === null || draftVersion === null) return;
    if (seededVersion.current === draftVersion) return;
    seededVersion.current = draftVersion;
    setCandidates([...draft.candidates]);
  }, [draft, draftVersion]);

  const captureStatus = capture.data?.status ?? null;
  useEffect(() => {
    if (captureStatus !== "needs_review" || captureId === null) return;
    if (countedReadyId.current === captureId) return;
    countedReadyId.current = captureId;
    recordClientMetric("capture_review_ready", { status: "ok" });
  }, [captureId, captureStatus]);

  const timezone = capture.data?.timezone ?? outbox.row?.timezone ?? null;
  const capturedAt = capture.data?.capturedAt ?? outbox.row?.capturedAt ?? null;
  const childId = capture.data?.childId ?? outbox.row?.childId ?? null;
  const workspaceId = capture.data?.workspaceId ?? outbox.row?.workspaceId ?? null;

  // Nothing to show: no server capture, and the local row is gone.
  if (captureId === null && outbox.row === null && !outbox.isLoading) {
    return (
      <Screen testID="review-capture">
        <StatusMessage tone="warning" message="This recording is not on this device any more." />
        <Button label="Back" variant="quiet" onPress={onClose} />
      </Screen>
    );
  }

  const progress = describeCaptureStatus({
    outboxStage: outbox.row?.stage ?? null,
    captureStatus: capture.data?.status ?? null,
    hasTranscript: draft?.rawTranscript !== null && draft?.rawTranscript !== undefined,
  });

  const isReadyForReview = capture.data?.status === "needs_review" && candidates !== null;
  const keptCount = (candidates ?? []).filter((candidate) => !candidate.discarded).length;
  const editing = (candidates ?? []).find((candidate) => candidate.id === editingId) ?? null;

  function applyCandidates(next: DraftCandidate[]): void {
    setCandidates(next);
    if (draftVersion === null) return;
    // The reviewed draft is persisted so closing the app does not lose a correction.
    updateDraft.mutate({ expectedDraftVersion: draftVersion, candidates: next });
  }

  function handleSave(): void {
    if (candidates === null || draftVersion === null) return;
    confirm.mutate(
      { expectedDraftVersion: draftVersion, candidates },
      {
        onSuccess: (response) => {
          // The server owns this capture now, so the local row and its file can be released.
          requestOutboxSync();
          // experience-design.md section 3: a quiet transition that offers Add photo or video
          // before the entries are left behind in the journal.
          setSavedEvents(response.events);
        },
      },
    );
  }

  // A recording that ran out of automatic attempts is queued again by hand.
  function handleLocalRetry(): void {
    if (localId === null) return;
    void openOutbox()
      .then((db) => retryOutboxCapture(db, localId))
      .then(requestOutboxSync);
  }

  if (savedEvents !== null) {
    return (
      <SavedCaptureTransition
        events={savedEvents}
        captureId={captureId}
        childId={childId}
        workspaceId={workspaceId}
        onDone={() => onSaved(savedEvents)}
      />
    );
  }

  return (
    <Screen scroll testID="review-capture">
      <CaptureProgressSteps progress={progress} />

      {capture.isError ? (
        <StatusMessage tone="error" message={describeError(capture.error)} />
      ) : null}

      {progress.hasFailed ? (
        <CaptureFailureActions
          message={
            capture.data?.status === "failed"
              ? describeCaptureError(capture.data.errorCode)
              : "This recording could not be sent after several tries. It is still on this phone."
          }
          canRetry={
            capture.data?.status === "failed"
              ? canRetryCaptureError(capture.data.errorCode)
              : localId !== null
          }
          isRetrying={retry.isPending}
          onRetry={capture.data?.status === "failed" ? () => retry.mutate() : handleLocalRetry}
          onEnterManually={() => {
            if (childId !== null) onEnterManually(childId);
          }}
        />
      ) : null}

      {isReadyForReview && candidates !== null && timezone !== null && capturedAt !== null ? (
        <View className="gap-lg">
          <Text className="text-lg font-semibold text-primary dark:text-primary-dark">
            Check these before saving
          </Text>

          {(draft?.notes ?? []).length === 0 ? null : (
            <View className="gap-sm" testID="review-notes">
              <Text className="text-sm font-semibold text-primary dark:text-primary-dark">
                Things to check
              </Text>
              {(draft?.notes ?? []).map((note) => (
                <StatusMessage key={note} tone="warning" message={note} />
              ))}
            </View>
          )}

          {candidates.length === 0 ? (
            <StatusMessage
              tone="warning"
              message="Nothing in this recording could be turned into an entry. You can add one by hand."
            />
          ) : (
            candidates.map((candidate) => (
              <DraftCandidateRow
                key={candidate.id}
                candidate={candidate}
                capturedAt={new Date(capturedAt)}
                timezone={timezone}
                onChange={(next) =>
                  applyCandidates(candidates.map((item) => (item.id === next.id ? next : item)))
                }
                onEdit={() => setEditingId(candidate.id)}
                testID={`draft-${candidate.id}`}
              />
            ))
          )}

          <TranscriptSection
            rawTranscript={draft?.rawTranscript ?? null}
            formattedText={draft?.formattedText ?? null}
          />

          {updateDraft.isError ? (
            <StatusMessage
              tone="warning"
              message="These edits are on this phone but could not be saved back yet."
            />
          ) : null}
          {confirm.isError ? (
            <StatusMessage tone="error" message={describeError(confirm.error)} />
          ) : null}

          {captureId === null || childId === null || workspaceId === null ? null : (
            <AttachmentPicker
              captureId={captureId}
              childId={childId}
              workspaceId={workspaceId}
              serverAttachmentCount={0}
              testID="review-attachments"
            />
          )}

          <Button
            label={`Save ${keptCount} update${keptCount === 1 ? "" : "s"}`}
            onPress={handleSave}
            isDisabled={keptCount === 0}
            isLoading={confirm.isPending}
            testID="review-save"
          />
          {keptCount === 0 ? (
            <Text className="text-sm text-muted dark:text-muted-dark">
              Every entry is removed, so there is nothing to save. Restore one, or add an entry by
              hand.
            </Text>
          ) : null}
          <Button
            label="Enter manually instead"
            variant="secondary"
            onPress={() => {
              if (childId !== null) onEnterManually(childId);
            }}
          />
        </View>
      ) : null}

      <Button label="Back" variant="quiet" onPress={onClose} testID="review-close" />

      {editing === null || timezone === null || candidates === null ? null : (
        <EditCandidateSheet
          candidate={editing}
          timezone={timezone}
          onSave={(next) => {
            setEditingId(null);
            applyCandidates(candidates.map((item) => (item.id === next.id ? next : item)));
          }}
          onClose={() => setEditingId(null)}
        />
      )}
    </Screen>
  );
}
