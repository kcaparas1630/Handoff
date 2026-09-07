import { useBootstrap, useOverview } from "@handoff/api-client";
import type { EventKind, LatestFact, OverviewDto } from "@handoff/contracts";
import { formatWallClock, renderAgeLabel } from "@handoff/domain";
import { useOutboxCaptures } from "@handoff/mobile";
import {
  Button,
  CareSnapshot,
  EventCard,
  HandoffCard,
  QuickCareActions,
  RecordButton,
  Screen,
  StatusMessage,
} from "@handoff/ui";
import type { CareSnapshotTile } from "@handoff/ui";
import { useState } from "react";
import { Text, View } from "react-native";

import { CareStatus } from "../care/CareStatus";
import { describeError } from "../shared/lib/describe-error";
import { useReducedMotion } from "../shared/useReducedMotion";
import { AttachmentViewer } from "./AttachmentViewer";
import { DashboardHeader } from "./DashboardHeader";
import { QuickEntrySheet } from "./QuickEntrySheet";
import { describeCaring } from "./lib/caring-line";
import { dedupeAttachmentsByCapture } from "./lib/dedupe-attachments-by-capture";
import { presentEvent } from "./lib/event-presentation";
import type { CareDashboardScreenProps } from "./types/care-dashboard-screen";

export function CareDashboardScreen({
  childId,
  flavor,
  onOpenHandoff,
  onOpenJournal,
  onOpenEvent,
  onOpenProfile,
  onOpenSettings,
  onOpenRecord,
  onOpenCapture,
}: CareDashboardScreenProps) {
  const overview = useOverview(childId);
  const bootstrap = useBootstrap();
  const pendingRecordings = useOutboxCaptures(childId);
  const isReducedMotion = useReducedMotion();
  const [entryKind, setEntryKind] = useState<EventKind | null>(null);
  const [savedFact, setSavedFact] = useState<string | null>(null);

  if (overview.isPending) {
    return (
      <Screen>
        <StatusMessage tone="info" message="Loading recent care…" />
      </Screen>
    );
  }

  if (overview.isError) {
    return (
      <Screen>
        <StatusMessage tone="error" message={describeError(overview.error)} />
        <Button label="Try again" onPress={() => void overview.refetch()} />
      </Screen>
    );
  }

  const data = overview.data;
  const workspace =
    bootstrap.data?.workspaces.find((candidate) => candidate.id === data.child.workspaceId) ?? null;
  const timezone = workspace?.timezone ?? null;
  const ownUserId = bootstrap.data?.user.id ?? null;
  const now = new Date(data.generatedAt);
  const ownSession = data.activeSessions.find(
    (session) => session.userId === ownUserId && session.endedAt === null,
  );
  // UI visibility is not authorization; the server rechecks every write.
  const canContribute = data.child.permission !== "reader" && timezone !== null;
  const hasHistory = data.recentActivity.length > 0 || hasAnyLatest(data);
  // One capture's photo belongs to all of its events; the preview shows it on the first of them.
  const attachmentsByEvent = dedupeAttachmentsByCapture(
    data.recentActivity.map((event) => ({ key: event.id, readyAssetIds: event.readyAssetIds })),
  );

  return (
    <Screen scroll testID="care-dashboard">
      <DashboardHeader
        childName={data.child.name}
        workspaceName={workspace?.name ?? "Workspace"}
        caringLine={describeCaring(data.activeSessions, ownUserId)}
        lastSyncedLine={describeLastSynced(overview.dataUpdatedAt, timezone)}
        onOpenProfile={() => onOpenProfile(childId)}
        onOpenSettings={() => onOpenSettings(childId)}
      />

      {savedFact === null ? null : <StatusMessage tone="success" message={`Saved: ${savedFact}`} />}

      <HandoffCard
        childName={data.child.name}
        unreadCount={data.unreadChangeCount}
        previewText={previewOf(data)}
        onOpen={() => onOpenHandoff(childId)}
      />

      <CareSnapshot tiles={buildTiles(data, now, timezone, onOpenEvent)} />

      {data.recentUnknownTime.length === 0 ? null : (
        <StatusMessage tone="info" message={describeUnknownTime(data.recentUnknownTime.length)} />
      )}

      {data.pendingCaptureCount === 0 ? null : (
        <StatusMessage tone="info" message={describePending(data.pendingCaptureCount)} />
      )}

      <RecordButton
        state={canContribute ? "idle" : "disabled"}
        onPress={() => onOpenRecord(childId)}
        hintText="Say a few things. Review them together."
        disabledReason={
          data.child.permission === "reader"
            ? "You can read this child's care but not add updates."
            : "Loading the workspace time zone before a recording can be saved."
        }
        isReducedMotion={isReducedMotion}
        testID="dashboard-record"
      />

      {pendingRecordings.length === 0 ? null : (
        <Button
          label={describePendingReview(pendingRecordings.length)}
          variant="secondary"
          onPress={() => onOpenCapture(captureRefFor(pendingRecordings[0]))}
          testID="dashboard-review-pending"
        />
      )}

      <QuickCareActions
        onSelect={setEntryKind}
        canContribute={canContribute}
        disabledReason={
          data.child.permission === "reader"
            ? "You can read this child's care but not add entries."
            : "Loading the workspace time zone before entries can be saved."
        }
      />

      {hasHistory ? (
        <View className="gap-md">
          <Text className="text-lg font-semibold text-primary dark:text-primary-dark">
            Recent updates and moments
          </Text>
          {data.recentActivity.map((event) => (
            <View key={event.id} className="gap-sm">
              <EventCard
                kind={event.kind}
                {...presentEvent(event, now, ownUserId)}
                isImportant={event.important}
                onPress={() => onOpenEvent(event.id)}
                testID={`dashboard-event-${event.id}`}
              />
              <AttachmentViewer assetIds={attachmentsByEvent[event.id] ?? []} />
            </View>
          ))}
          <Button
            label="View all activity"
            variant="secondary"
            onPress={() => onOpenJournal(childId)}
            testID="dashboard-open-journal"
          />
        </View>
      ) : (
        <View className="gap-md rounded-md border border-border bg-surface px-lg py-lg dark:border-border-dark dark:bg-surface-dark">
          <Text className="text-lg font-semibold text-primary dark:text-primary-dark">
            Nothing recorded for {data.child.name} yet
          </Text>
          <Text className="text-base text-muted dark:text-muted-dark">
            {emptyStateExample(flavor)}
          </Text>
          {canContribute ? (
            <Button
              label="Add a diaper entry"
              onPress={() => setEntryKind("diaper")}
              testID="dashboard-empty-entry"
            />
          ) : null}
        </View>
      )}

      <CareStatus childId={childId} permission={data.child.permission} />

      {entryKind === null || timezone === null ? null : (
        <QuickEntrySheet
          key={entryKind}
          childId={childId}
          childName={data.child.name}
          kind={entryKind}
          timezone={timezone}
          {...(ownSession === undefined ? {} : { careSessionId: ownSession.id })}
          onSaved={(event) => {
            setEntryKind(null);
            setSavedFact(
              event === null ? null : presentEvent(event, new Date(), ownUserId).factText,
            );
          }}
          onClose={() => setEntryKind(null)}
        />
      )}
    </Screen>
  );
}

function emptyStateExample(flavor: "parents" | "daycare"): string {
  const example = "A first entry can be small, like a wet diaper at 08:50.";
  return flavor === "daycare"
    ? `${example} Everything recorded here is what the family reads at pickup.`
    : `${example} Whoever cares next reads exactly what you recorded.`;
}

function describeUnknownTime(count: number): string {
  const subject = count === 1 ? "entry has" : "entries have";
  return `${count} recent ${subject} no stated time, so they are not ranked as the latest care.`;
}

function describePending(count: number): string {
  return `Still processing: ${count} recording${count === 1 ? "" : "s"}.`;
}

function describePendingReview(count: number): string {
  return count === 1 ? "Review pending update" : `Review pending updates (${count})`;
}

// A recording the server has not acknowledged is addressed by its local id.
function captureRefFor(row: { captureId: string | null; localId: string } | undefined): string {
  if (row === undefined) return "";
  return row.captureId ?? `local:${row.localId}`;
}

function hasAnyLatest(data: OverviewDto): boolean {
  return data.latest.feed !== null || data.latest.sleep !== null || data.latest.diaper !== null;
}

function previewOf(data: OverviewDto): string | null {
  return data.latest.feed?.text ?? data.latest.diaper?.text ?? data.latest.sleep?.text ?? null;
}

function describeLastSynced(updatedAt: number, timezone: string | null): string {
  if (updatedAt === 0 || timezone === null) return "Not synced yet";
  return `Last synced ${formatWallClock(new Date(updatedAt), timezone)}`;
}

function buildTiles(
  data: OverviewDto,
  now: Date,
  timezone: string | null,
  onOpenEvent: (eventId: string) => void,
): readonly CareSnapshotTile[] {
  const toTile = (kind: "feed" | "sleep" | "diaper", fact: LatestFact | null): CareSnapshotTile => {
    if (fact === null) return { kind, factText: null, timeLabel: null };
    const occurredAt = fact.occurredAt === null ? null : new Date(fact.occurredAt);
    return {
      kind,
      factText: fact.text,
      // A missing occurrence time stays missing; the tile then says the time was not given.
      timeLabel:
        occurredAt === null || timezone === null ? null : renderAgeLabel(occurredAt, now, timezone),
      onPress: () => onOpenEvent(fact.eventId),
    };
  };

  return [
    toTile("feed", data.latest.feed),
    toTile("sleep", data.latest.sleep),
    toTile("diaper", data.latest.diaper),
  ];
}
