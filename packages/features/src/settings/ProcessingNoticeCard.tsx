import { useUpdateSelf } from "@handoff/api-client";
import { Button, StatusMessage } from "@handoff/ui";
import { Text, View } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import {
  PROCESSING_NOTICE_POINTS,
  PROCESSING_NOTICE_SUMMARY,
  PROCESSING_NOTICE_TITLE,
  PROCESSING_NOTICE_VERSION,
  hasAcceptedProcessingNotice,
} from "./lib/processing-notice";
import type { ProcessingNoticeCardProps } from "./types/processing-notice";

/**
 * The notice itself plus its Accept action. Shown in privacy settings and, when the account has
 * not accepted this version yet, inline on the record screen before voice or typing is allowed.
 */
export function ProcessingNoticeCard({
  acceptedVersion,
  reason,
  onAccepted,
}: ProcessingNoticeCardProps) {
  const updateSelf = useUpdateSelf();
  const isAccepted = hasAcceptedProcessingNotice(acceptedVersion);

  function accept(): void {
    updateSelf.mutate(
      { processingNoticeVersion: PROCESSING_NOTICE_VERSION },
      { onSuccess: () => onAccepted?.() },
    );
  }

  return (
    <View
      className="gap-md rounded-md border border-border bg-surface px-lg py-lg dark:border-border-dark dark:bg-surface-dark"
      testID="processing-notice"
    >
      <Text className="text-lg font-semibold text-primary dark:text-primary-dark">
        {PROCESSING_NOTICE_TITLE}
      </Text>
      <Text className="text-base text-primary dark:text-primary-dark">
        {PROCESSING_NOTICE_SUMMARY}
      </Text>

      {reason === undefined || isAccepted ? null : <StatusMessage tone="info" message={reason} />}

      {PROCESSING_NOTICE_POINTS.map((point) => (
        <View key={point.id} className="gap-xs">
          <Text className="text-base font-semibold text-primary dark:text-primary-dark">
            {point.heading}
          </Text>
          <Text className="text-sm text-muted dark:text-muted-dark">{point.body}</Text>
        </View>
      ))}

      {updateSelf.isError ? (
        <StatusMessage tone="error" message={describeError(updateSelf.error)} />
      ) : null}

      {isAccepted ? (
        <StatusMessage
          tone="success"
          message={`You accepted this notice (version ${PROCESSING_NOTICE_VERSION}). Recording and typed updates are available.`}
          testID="processing-notice-accepted"
        />
      ) : (
        <>
          {acceptedVersion === null ? null : (
            <StatusMessage
              tone="warning"
              message={`This notice changed since you last accepted it (you accepted version ${acceptedVersion}). Read it again to keep using recording and typed updates.`}
            />
          )}
          <Button
            label="Accept and continue"
            onPress={accept}
            isLoading={updateSelf.isPending}
            accessibilityHint="Records that you have read what is sent to the transcription and AI providers"
            testID="processing-notice-accept"
          />
        </>
      )}
    </View>
  );
}
