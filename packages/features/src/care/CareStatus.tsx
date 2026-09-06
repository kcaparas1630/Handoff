import { useBootstrap, useCare, useCareAction } from "@handoff/api-client";
import { Button, StatusMessage } from "@handoff/ui";
import { Text, View } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import type { CareStatusProps } from "./types/care-status";

export function CareStatus({ childId, permission }: CareStatusProps) {
  const bootstrap = useBootstrap();
  const care = useCare(childId);
  const careAction = useCareAction(childId);

  const ownUserId = bootstrap.data?.user.id ?? null;
  const openSessions = (care.data?.sessions ?? []).filter((session) => session.endedAt === null);
  const ownSession = openSessions.find((session) => session.userId === ownUserId) ?? null;
  const otherSessions = openSessions.filter((session) => session.userId !== ownUserId);

  return (
    <View className="gap-md rounded-md border border-border bg-surface px-lg py-lg dark:border-border-dark dark:bg-surface-dark">
      <Text className="text-lg font-semibold text-primary dark:text-primary-dark">Care now</Text>

      {care.isPending ? <StatusMessage tone="info" message="Loading care sessions…" /> : null}

      {care.isError ? (
        <>
          <StatusMessage tone="error" message={describeError(care.error)} />
          <Button label="Try again" variant="secondary" onPress={() => void care.refetch()} />
        </>
      ) : null}

      {care.isSuccess && openSessions.length === 0 ? (
        <Text className="text-base text-muted dark:text-muted-dark">
          Nobody has said they are caring right now.
        </Text>
      ) : null}

      {ownSession === null ? null : (
        <Text className="text-base text-primary dark:text-primary-dark">
          You said you are caring for this child.
        </Text>
      )}

      {otherSessions.map((session) => (
        <Text key={session.id} className="text-base text-primary dark:text-primary-dark">
          {session.displayName ?? "Another caregiver"} is caring
        </Text>
      ))}

      {careAction.isError ? (
        <StatusMessage tone="error" message={describeError(careAction.error)} />
      ) : null}

      <Button
        label={ownSession === null ? "Start care" : "End care"}
        variant={ownSession === null ? "primary" : "secondary"}
        onPress={() => careAction.mutate({ action: ownSession === null ? "start" : "end" })}
        isLoading={careAction.isPending}
        accessibilityHint={
          ownSession === null
            ? "Tells other caregivers you are with this child"
            : "Ends only your own session; other caregivers stay active"
        }
        testID="care-status-action"
      />

      {permission === "reader" ? (
        <Text className="text-sm text-muted dark:text-muted-dark">
          You can say you are caring. It does not change what you can see or add.
        </Text>
      ) : null}
    </View>
  );
}
