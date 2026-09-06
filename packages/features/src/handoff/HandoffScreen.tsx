import { useAcknowledgeBrief, useBootstrap, useBrief, useCreateBrief } from "@handoff/api-client";
import type { BriefContextFact, BriefEntry, HandoffBriefDto } from "@handoff/contracts";
import { formatWallDate } from "@handoff/domain";
import { Button, Screen, StatusMessage } from "@handoff/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import { BriefEntryRow } from "./BriefEntryRow";
import type { HandoffScreenProps } from "./types/handoff-screen";

// Used only if the workspace is not loaded yet; it is the reader's own zone, never an invented one.
const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function HandoffScreen({ childId, onDone, onOpenEvent }: HandoffScreenProps) {
  const bootstrap = useBootstrap();
  const createBrief = useCreateBrief(childId);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<readonly string[]>([]);
  const hasRequested = useRef(false);
  const brief = useBrief(briefId);
  const acknowledge = useAcknowledgeBrief(briefId ?? "");

  const requestBrief = useCallback(() => {
    createBrief.mutate(undefined, { onSuccess: (created) => setBriefId(created.id) });
  }, [createBrief]);

  // One snapshot per visit. Opening or regenerating a brief never advances the caller's cursor.
  useEffect(() => {
    if (hasRequested.current) return;
    hasRequested.current = true;
    requestBrief();
  }, [requestBrief]);

  const current: HandoffBriefDto | null = brief.data ?? createBrief.data ?? null;

  if (createBrief.isError) {
    return (
      <Screen>
        <StatusMessage tone="error" message={describeError(createBrief.error)} />
        <Button label="Try again" onPress={requestBrief} />
        <Button label="Back" variant="quiet" onPress={onDone} />
      </Screen>
    );
  }

  if (current === null) {
    return (
      <Screen>
        <StatusMessage tone="info" message="Putting together your handoff…" />
      </Screen>
    );
  }

  const workspace =
    bootstrap.data?.workspaces.find((candidate) => candidate.id === current.workspaceId) ?? null;
  const timezone = workspace?.timezone ?? deviceTimezone;
  const { snapshot } = current;

  function toggle(eventId: string): void {
    setExpandedIds((ids) =>
      ids.includes(eventId) ? ids.filter((id) => id !== eventId) : [...ids, eventId],
    );
  }

  function renderEntries(entries: readonly BriefEntry[]): ReactNode {
    return entries.map((entry) => (
      <BriefEntryRow
        key={`${entry.eventId}-${entry.revisionId}`}
        entry={entry}
        timezone={timezone}
        isExpanded={expandedIds.includes(entry.eventId)}
        onToggle={() => toggle(entry.eventId)}
        onOpenEvent={onOpenEvent}
      />
    ));
  }

  return (
    <Screen scroll testID="handoff-screen">
      <View className="gap-xs">
        <Text className="text-2xl font-semibold text-primary dark:text-primary-dark">
          {snapshot.boundary.label}
        </Text>
        <Text className="text-sm text-muted dark:text-muted-dark">
          {describeBaseline(snapshot.boundary, timezone)}
        </Text>
      </View>

      {current.status === "ready" ? null : (
        <StatusMessage
          tone="warning"
          message="Some sources in this brief are no longer available to you, so parts were withheld."
        />
      )}

      {current.isStale ? (
        <>
          <StatusMessage tone="info" message={describeStaleness(current.newerChangeCount)} />
          <Button
            label="Refresh"
            variant="secondary"
            onPress={requestBrief}
            isLoading={createBrief.isPending}
            testID="handoff-refresh"
          />
        </>
      ) : null}

      {snapshot.pendingCaptureCount === 0 ? null : (
        <StatusMessage tone="info" message={describePending(snapshot.pendingCaptureCount)} />
      )}

      <Section
        title="Recent essentials"
        emptyMessage="No feed, sleep, or diaper recorded yet."
        isEmpty={snapshot.essentials.length === 0}
      >
        {snapshot.essentials.map((fact) => (
          <EssentialRow key={`${fact.kind}-${fact.revisionId}`} fact={fact} />
        ))}
      </Section>

      <Section
        title="Updates"
        emptyMessage="No confirmed changes in this window."
        isEmpty={snapshot.updates.length === 0}
      >
        {renderEntries(snapshot.updates)}
      </Section>

      <Section
        title="Moments"
        emptyMessage="No reported moments in this window."
        isEmpty={snapshot.moments.length === 0}
      >
        {renderEntries(snapshot.moments)}
      </Section>

      {acknowledge.isError ? (
        <StatusMessage tone="error" message={describeError(acknowledge.error)} />
      ) : null}

      {current.acknowledgedAt === null ? (
        <View className="gap-md">
          <Button
            label="I've read this — start care"
            onPress={() => acknowledge.mutate({ startCare: true }, { onSuccess: onDone })}
            isLoading={acknowledge.isPending}
            accessibilityHint="Marks this brief as read and opens your own care session"
            testID="handoff-acknowledge-start"
          />
          <Button
            label="Mark as read"
            variant="secondary"
            onPress={() => acknowledge.mutate({ startCare: false }, { onSuccess: onDone })}
            isLoading={acknowledge.isPending}
            accessibilityHint="Marks this brief as read without starting care"
            testID="handoff-acknowledge-only"
          />
        </View>
      ) : (
        <StatusMessage
          tone="success"
          message="You marked this handoff as read. Any newer changes stay unread."
        />
      )}

      {/* Reading is not acknowledging: leaving here keeps every update unread. */}
      <Button label="Close without marking read" variant="quiet" onPress={onDone} />
    </Screen>
  );
}

function Section({
  title,
  emptyMessage,
  isEmpty,
  children,
}: {
  title: string;
  emptyMessage: string;
  isEmpty: boolean;
  children: ReactNode;
}) {
  return (
    <View className="gap-md">
      <Text className="text-lg font-semibold text-primary dark:text-primary-dark">{title}</Text>
      {isEmpty ? (
        <Text className="text-base text-muted dark:text-muted-dark">{emptyMessage}</Text>
      ) : (
        children
      )}
    </View>
  );
}

function EssentialRow({ fact }: { fact: BriefContextFact }) {
  return (
    <View className="gap-xs rounded-md border border-border bg-surface px-lg py-md dark:border-border-dark dark:bg-surface-dark">
      <Text className="text-base text-primary dark:text-primary-dark">{fact.text}</Text>
      <Text className="text-sm text-muted dark:text-muted-dark">{fact.ageLabel}</Text>
      {fact.precedesWindow ? (
        <Text className="text-sm font-semibold text-muted dark:text-muted-dark">
          Recorded before this window
        </Text>
      ) : null}
    </View>
  );
}

function describeStaleness(count: number): string {
  return `New updates available — ${count} change${
    count === 1 ? "" : "s"
  } arrived after this brief was made. Refresh to include them.`;
}

function describePending(count: number): string {
  return `Still processing: ${count} recording${
    count === 1 ? "" : "s"
  }. They are not in this brief yet.`;
}

function describeBaseline(
  boundary: HandoffBriefDto["snapshot"]["boundary"],
  timezone: string,
): string {
  if (boundary.fromSeqExclusive > 0) {
    return "Everything published since you last marked a handoff as read.";
  }
  if (boundary.initialWindowStart === null) {
    return "First handoff. This is the disclosed starting point, not the whole history.";
  }
  const start = formatWallDate(new Date(boundary.initialWindowStart), timezone);
  return `First handoff. The disclosed starting window opens ${start}; older history stays in the journal.`;
}
