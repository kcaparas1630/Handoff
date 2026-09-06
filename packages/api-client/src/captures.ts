import { captureDtoSchema } from "@handoff/contracts";
import type {
  CaptureDto,
  ConfirmCaptureResponse,
  DraftCandidate,
  EventDto,
} from "@handoff/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import {
  confirmCapture,
  createTextCapture,
  retryCapture,
  updateCaptureDraft,
} from "./capture-requests";
import { capturePollInterval } from "./lib/capture-poll-interval";
import { useApiClient, useApiUserId } from "./provider";
import { queryKeys } from "./query-keys";
import type { ApiClient } from "./types/api-client";

export type SaveManualEntryInput = {
  /** The reviewed entry, already validated against the domain event rules by the caller. */
  candidate: DraftCandidate;
  /** When the caregiver saved it, which is not the same as when the care happened. */
  capturedAt: string;
  timezone: string;
  locale: string;
  /** The caller's own open care session, when there is one. */
  careSessionId?: string;
};

export type CreateTextCaptureVariables = Omit<SaveManualEntryInput, "candidate"> & { text: string };

export type UpdateCaptureDraftVariables = {
  expectedDraftVersion: number;
  candidates: readonly DraftCandidate[];
};

export type ConfirmCaptureVariables = UpdateCaptureDraftVariables;

type CreateManualCaptureInput = SaveManualEntryInput & { childId: string; clientCaptureId: string };

// Manual entry skips extraction, so the capture is created with the single reviewed candidate.
function createManualCapture(
  client: ApiClient,
  input: CreateManualCaptureInput,
): Promise<CaptureDto> {
  const { candidate, capturedAt, timezone, locale, childId, clientCaptureId } = input;
  return client.request(captureDtoSchema, {
    method: "POST",
    path: "/v1/captures",
    // Reuses the client capture id so a replayed request cannot allocate a second capture.
    idempotencyKey: clientCaptureId,
    body: {
      childId,
      clientCaptureId,
      inputKind: "manual",
      capturedAt,
      timezone,
      locale,
      candidates: [candidate],
      ...(input.careSessionId === undefined ? {} : { careSessionId: input.careSessionId }),
    },
  });
}

/**
 * The only manual create path: allocate the capture with one reviewed candidate, then confirm it.
 * Each request carries its own idempotency key, and nothing is written into the cache until the
 * server answers, because a confirmed event is never shown optimistically (architecture.md 7).
 */
export function useSaveManualEntry(childId: string) {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveManualEntryInput): Promise<EventDto | null> => {
      // A fresh id per save attempt: a retry after an edit allocates its own capture rather than
      // colliding with the previous body under the same key.
      const clientCaptureId = crypto.randomUUID();
      const capture = await createManualCapture(client, { ...input, childId, clientCaptureId });
      const confirmed = await confirmCapture(client, capture.id, capture.draftVersion, [
        input.candidate,
      ]);
      return confirmed.events[0] ?? null;
    },
    onSuccess: () => invalidateChildJournal(queryClient, userId, childId),
  });
}

/** Typed entry. It produces a reviewable draft rather than publishing anything. */
export function useCreateTextCapture(childId: string) {
  const client = useApiClient();

  return useMutation({
    mutationFn: (input: CreateTextCaptureVariables): Promise<CaptureDto> =>
      createTextCapture(client, {
        ...input,
        childId,
        clientCaptureId: crypto.randomUUID(),
      }),
  });
}

export type UseCaptureOptions = { pollWhileProcessing?: boolean };

/**
 * Watches one capture. Polling follows architecture.md section 7: two seconds while the server is
 * still working, backing off after half a minute, and off once the capture is reviewable.
 */
export function useCapture(captureId: string | null, options: UseCaptureOptions = {}) {
  const client = useApiClient();
  const userId = useApiUserId();
  const watchStartedAt = useRef(Date.now());

  return useQuery({
    queryKey: queryKeys.capture(userId, captureId),
    enabled: userId !== null && captureId !== null,
    refetchInterval: (query) => {
      if (options.pollWhileProcessing !== true) return false;
      const status = query.state.data?.status ?? null;
      return capturePollInterval(status, Date.now() - watchStartedAt.current);
    },
    refetchIntervalInBackground: false,
    queryFn: () =>
      client.request(captureDtoSchema, {
        method: "GET",
        path: `/v1/captures/${encodeURIComponent(captureId ?? "")}`,
      }),
  });
}

/** Persists review edits. Only the draft changes; no event is published. */
export function useUpdateCaptureDraft(captureId: string) {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ expectedDraftVersion, candidates }: UpdateCaptureDraftVariables) =>
      updateCaptureDraft(client, captureId, expectedDraftVersion, candidates),
    onSuccess: (capture) => {
      queryClient.setQueryData(queryKeys.capture(userId, captureId), capture);
    },
  });
}

/** Publishes the reviewed candidates. The caller invokes this only from an explicit Save tap. */
export function useConfirmCapture(captureId: string) {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      expectedDraftVersion,
      candidates,
    }: ConfirmCaptureVariables): Promise<ConfirmCaptureResponse> =>
      confirmCapture(client, captureId, expectedDraftVersion, candidates),
    onSuccess: async (response) => {
      queryClient.setQueryData(queryKeys.capture(userId, captureId), response.capture);
      await invalidateChildJournal(queryClient, userId, response.capture.childId);
    },
  });
}

/** Asks the server to run the failed capture again. It is idempotent and takes no body. */
export function useRetryCapture(captureId: string) {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => retryCapture(client, captureId, crypto.randomUUID()),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.capture(userId, captureId), response.capture);
    },
  });
}

async function invalidateChildJournal(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string | null,
  childId: string,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.overview(userId, childId) });
  await queryClient.invalidateQueries({ queryKey: queryKeys.events(userId, childId) });
}
