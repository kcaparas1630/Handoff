import {
  isApiClientError,
  useDeleteEvent,
  useEvents,
  useOverview,
  useUpdateEvent,
} from "@handoff/api-client";
import type { EventDto } from "@handoff/contracts";
import { Button, Screen, StatusMessage } from "@handoff/ui";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";

import { ChoiceChips } from "../shared/ChoiceChips";
import { describeError } from "../shared/lib/describe-error";
import { EntryFieldGroup } from "./entry/EntryFieldGroup";
import { OccurrenceTimeControl } from "./entry/OccurrenceTimeControl";
import { buildEntryFields } from "./lib/entry-fields";
import { entryFormFromEvent } from "./lib/entry-form";
import { fieldErrorsFromApi, toFieldErrors } from "./lib/field-errors";
import type { EntryFieldErrors } from "./types/entry-field-groups";
import type { EntryForm } from "./types/entry-form";
import type { EventEditorProps } from "./types/event-editor";

const conflictMessage = "This entry changed on another device; reload it before correcting.";

const importantOption = [{ value: "important", label: "Mark as important" }] as const;

export function EventEditor({ eventId, childId, onDone }: EventEditorProps) {
  const events = useEvents(childId);
  const overview = useOverview(childId);
  const update = useUpdateEvent();
  const remove = useDeleteEvent();
  const [form, setForm] = useState<EntryForm | null>(null);
  const [errors, setErrors] = useState<EntryFieldErrors>({});

  const event = findEvent(eventId, events.data?.pages, overview.data?.recentActivity);

  // The form is seeded once; a reload after a conflict clears it so the newer values load.
  useEffect(() => {
    if (event === null || form !== null) return;
    setForm(entryFormFromEvent(event));
  }, [event, form]);

  if (event === null) {
    return (
      <Screen scroll>
        <StatusMessage
          tone={events.isPending ? "info" : "warning"}
          message={
            events.isPending
              ? "Looking for this entry…"
              : "This entry is not in the pages loaded so far."
          }
        />
        {events.hasNextPage ? (
          <Button
            label="Load more entries"
            onPress={() => void events.fetchNextPage()}
            isLoading={events.isFetchingNextPage}
          />
        ) : null}
        <Button label="Back" variant="quiet" onPress={onDone} />
      </Screen>
    );
  }

  if (form === null) {
    return (
      <Screen>
        <StatusMessage tone="info" message="Loading this entry…" />
      </Screen>
    );
  }

  function reload(): void {
    setForm(null);
    setErrors({});
    update.reset();
    void events.refetch();
  }

  function handleCorrect(): void {
    if (event === null || form === null) return;
    const built = buildEntryFields(event.kind, form);
    if (!built.ok) {
      setErrors(toFieldErrors(built.errors));
      return;
    }
    setErrors({});
    update.mutate(
      {
        eventId: event.id,
        expectedVersion: event.version,
        occurredAt: built.fields.occurredAt?.toISOString() ?? null,
        endedAt: built.fields.endedAt?.toISOString() ?? null,
        timePrecision: built.fields.timePrecision,
        amountValue: built.fields.amountValue,
        amountUnit: built.fields.amountUnit,
        details: built.fields.details,
        important: built.fields.important,
      },
      {
        onSuccess: onDone,
        onError: (error) => {
          if (isApiClientError(error)) setErrors(fieldErrorsFromApi(error.fieldErrors));
        },
      },
    );
  }

  function handleRemove(): void {
    if (event === null) return;
    Alert.alert(
      "Remove this entry?",
      "It stops counting as recorded care and shows as removed in the next handoff.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            remove.mutate(
              { eventId: event.id, expectedVersion: event.version },
              { onSuccess: onDone },
            ),
        },
      ],
    );
  }

  const isRemoved = event.status === "deleted";
  const hasConflict = isConflict(update.error) || isConflict(remove.error);

  return (
    <Screen scroll testID="event-editor">
      <Text className="text-2xl font-semibold text-primary dark:text-primary-dark">
        Correct this entry
      </Text>
      <Text className="text-sm text-muted dark:text-muted-dark">
        Times are shown in {event.timezone}. Corrections publish a new revision that caregivers see
        as an update.
      </Text>

      {isRemoved ? (
        <StatusMessage tone="warning" message="This entry was removed and is no longer recorded." />
      ) : null}

      {hasConflict ? (
        <>
          <StatusMessage tone="warning" message={conflictMessage} />
          <Button label="Reload" onPress={reload} testID="event-editor-reload" />
        </>
      ) : null}

      {!hasConflict && update.isError ? (
        <StatusMessage tone="error" message={describeError(update.error)} />
      ) : null}
      {!hasConflict && remove.isError ? (
        <StatusMessage tone="error" message={describeError(remove.error)} />
      ) : null}

      <View className="gap-lg">
        <EntryFieldGroup
          kind={event.kind}
          form={form}
          onChange={setForm}
          timezone={event.timezone}
          errors={errors}
        />

        <OccurrenceTimeControl
          label="When did this happen?"
          timezone={event.timezone}
          value={form.occurrence}
          onChange={(occurrence) => setForm({ ...form, occurrence })}
          errorMessage={errors.occurredAt}
        />

        <ChoiceChips
          label="Important?"
          options={importantOption}
          selectedValues={form.important ? ["important"] : []}
          onSelect={() => setForm({ ...form, important: !form.important })}
        />
      </View>

      <Button
        label="Correct"
        onPress={handleCorrect}
        isDisabled={isRemoved || form.occurrence.choice === null}
        isLoading={update.isPending}
        testID="event-editor-correct"
      />
      <Button
        label="Remove"
        variant="secondary"
        onPress={handleRemove}
        isDisabled={isRemoved}
        isLoading={remove.isPending}
        testID="event-editor-remove"
      />
      <Button label="Back" variant="quiet" onPress={onDone} />
    </Screen>
  );
}

function findEvent(
  eventId: string,
  pages: readonly { items: readonly EventDto[] }[] | undefined,
  recentActivity: readonly EventDto[] | undefined,
): EventDto | null {
  for (const page of pages ?? []) {
    const found = page.items.find((item) => item.id === eventId);
    if (found !== undefined) return found;
  }
  return (recentActivity ?? []).find((item) => item.id === eventId) ?? null;
}

function isConflict(error: unknown): boolean {
  return isApiClientError(error) && error.code === "conflict";
}
