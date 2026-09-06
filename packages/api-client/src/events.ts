import { eventDtoSchema, eventsPageSchema } from "@handoff/contracts";
import type { EventKind, UpdateEventRequest } from "@handoff/contracts";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useApiClient, useApiUserId } from "./provider";
import { queryKeys } from "./query-keys";

export type UpdateEventVariables = UpdateEventRequest & { eventId: string };

export type DeleteEventVariables = { eventId: string; expectedVersion: number };

function eventsPath(childId: string, kind: EventKind | null, cursor: string | null): string {
  const query = new URLSearchParams();
  if (kind !== null) query.set("kind", kind);
  if (cursor !== null) query.set("cursor", cursor);
  const search = query.toString();
  const base = `/v1/children/${encodeURIComponent(childId)}/events`;
  return search.length === 0 ? base : `${base}?${search}`;
}

/** Confirmed timeline only. The server issues the cursors; the client never builds one. */
export function useEvents(childId: string | null, kind: EventKind | null = null) {
  const client = useApiClient();
  const userId = useApiUserId();

  return useInfiniteQuery({
    queryKey: [...queryKeys.events(userId, childId), kind ?? "all"],
    enabled: userId !== null && childId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      client.request(eventsPageSchema, {
        method: "GET",
        path: eventsPath(childId ?? "", kind, pageParam),
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useUpdateEvent() {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ eventId, expectedVersion, ...changes }: UpdateEventVariables) =>
      client.request(eventDtoSchema, {
        method: "PATCH",
        path: `/v1/events/${encodeURIComponent(eventId)}`,
        body: changes,
        expectedVersion,
      }),
    // The corrected event is confirmed data, so the caches are refetched instead of patched.
    onSuccess: async (event) => {
      await invalidateChildJournal(queryClient, userId, event.childId);
    },
  });
}

export function useDeleteEvent() {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ eventId, expectedVersion }: DeleteEventVariables) =>
      client.request(eventDtoSchema, {
        method: "DELETE",
        path: `/v1/events/${encodeURIComponent(eventId)}`,
        expectedVersion,
      }),
    onSuccess: async (event) => {
      await invalidateChildJournal(queryClient, userId, event.childId);
    },
  });
}

async function invalidateChildJournal(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string | null,
  childId: string,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.events(userId, childId) });
  await queryClient.invalidateQueries({ queryKey: queryKeys.overview(userId, childId) });
}
