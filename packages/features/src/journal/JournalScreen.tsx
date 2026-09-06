import { useBootstrap, useEvents } from "@handoff/api-client";
import { Button, EventCard, Screen, StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { View } from "react-native";

import { ChoiceChips } from "../shared/ChoiceChips";
import type { ChoiceOption } from "../shared/types/choice-chips";
import { describeError } from "../shared/lib/describe-error";
import { AttachmentViewer } from "./AttachmentViewer";
import { dedupeAttachmentsByCapture } from "./lib/dedupe-attachments-by-capture";
import { presentEvent } from "./lib/event-presentation";
import type { JournalFilter, JournalScreenProps } from "./types/journal-screen";

const filterOptions: readonly ChoiceOption<JournalFilter>[] = [
  { value: "all", label: "All" },
  { value: "feed", label: "Feed" },
  { value: "diaper", label: "Diaper" },
  { value: "sleep", label: "Sleep" },
  { value: "milestone", label: "Milestone" },
  { value: "note", label: "Note" },
];

export function JournalScreen({ childId, onOpenEvent, onBack }: JournalScreenProps) {
  const [filter, setFilter] = useState<JournalFilter>("all");
  const bootstrap = useBootstrap();
  const events = useEvents(childId, filter === "all" ? null : filter);

  const ownUserId = bootstrap.data?.user.id ?? null;
  const now = events.dataUpdatedAt === 0 ? new Date() : new Date(events.dataUpdatedAt);
  const items = events.data?.pages.flatMap((page) => page.items) ?? [];
  // Every event from one capture carries that capture's attachments; the list shows them once.
  const attachmentsByEvent = dedupeAttachmentsByCapture(
    items.map((event) => ({ key: event.id, readyAssetIds: event.readyAssetIds })),
  );

  return (
    <Screen scroll testID="journal-screen">
      <ChoiceChips
        label="Show"
        options={filterOptions}
        selectedValues={[filter]}
        onSelect={setFilter}
        testID="journal-filter"
      />

      {events.isPending ? <StatusMessage tone="info" message="Loading the journal…" /> : null}

      {events.isError ? (
        <>
          <StatusMessage tone="error" message={describeError(events.error)} />
          <Button label="Try again" onPress={() => void events.refetch()} />
        </>
      ) : null}

      {events.isSuccess && items.length === 0 ? (
        <StatusMessage
          tone="info"
          message={
            filter === "all"
              ? "Nothing recorded yet."
              : "Nothing recorded yet for this kind of entry."
          }
        />
      ) : null}

      <View className="gap-md">
        {items.map((event) => (
          <View key={event.id} className="gap-sm">
            <EventCard
              kind={event.kind}
              {...presentEvent(event, now, ownUserId)}
              isImportant={event.important}
              onPress={() => onOpenEvent(event.id)}
              testID={`journal-event-${event.id}`}
            />
            <AttachmentViewer assetIds={attachmentsByEvent[event.id] ?? []} />
          </View>
        ))}
      </View>

      {events.hasNextPage ? (
        <Button
          label="Load more"
          variant="secondary"
          onPress={() => void events.fetchNextPage()}
          isLoading={events.isFetchingNextPage}
          testID="journal-load-more"
        />
      ) : null}

      <Button label="Back" variant="quiet" onPress={onBack} />
    </Screen>
  );
}
