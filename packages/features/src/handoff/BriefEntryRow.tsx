import { formatWallClock, renderAgeLabel } from "@handoff/domain";
import { Button, EventCard } from "@handoff/ui";
import type { EventCardTag } from "@handoff/ui";
import { Text, View } from "react-native";

import { AttachmentViewer } from "../journal/AttachmentViewer";
import type { BriefEntryRowProps } from "./types/handoff-screen";

/** Every rendered fact keeps a path to the revision it came from (architecture.md section 5). */
export function BriefEntryRow({
  entry,
  assetIds,
  timezone,
  isExpanded,
  onToggle,
  onOpenEvent,
}: BriefEntryRowProps) {
  const reportedAt = new Date(entry.reportedAt);
  const occurredAt = entry.occurredAt === null ? null : new Date(entry.occurredAt);
  const happened =
    occurredAt === null
      ? "Time not given"
      : `Happened ${renderAgeLabel(occurredAt, reportedAt, timezone)}`;
  const author = entry.authorDisplayName ?? "another caregiver";

  return (
    <View className="gap-sm">
      <EventCard
        kind={entry.kind}
        factText={entry.text}
        timeLine={`${happened} · reported ${formatWallClock(reportedAt, timezone)}`}
        authorLabel={`Reported by ${author}`}
        isImportant={entry.important}
        tag={tagOf(entry.label)}
        onPress={onToggle}
      />
      <AttachmentViewer assetIds={assetIds} label="Shared with this update" />

      {isExpanded ? (
        <View className="gap-xs rounded-md border border-border px-lg py-md dark:border-border-dark">
          <Text className="text-sm text-muted dark:text-muted-dark">
            Reported {formatWallClock(reportedAt, timezone)} by {author}
          </Text>
          <Text className="text-sm text-muted dark:text-muted-dark">
            Source revision {entry.revisionId.slice(0, 8)}
          </Text>
          <Button
            label="Open the entry"
            variant="secondary"
            onPress={() => onOpenEvent(entry.eventId)}
          />
        </View>
      ) : null}
    </View>
  );
}

function tagOf(label: string): EventCardTag | undefined {
  if (label === "updated") return "updated";
  if (label === "removed") return "removed";
  return undefined;
}
