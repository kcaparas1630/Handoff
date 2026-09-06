import { captureDtoSchema, confirmCaptureResponseSchema } from "@handoff/contracts";
import type { CaptureDto, DraftCandidate, EventDto } from "@handoff/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ApiClient } from "./types/api-client";
import { useApiClient, useApiUserId } from "./provider";
import { queryKeys } from "./query-keys";

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

function confirmCapture(client: ApiClient, capture: CaptureDto, candidate: DraftCandidate) {
  // Source spans stay server-side; the confirm body carries the reviewed fields only.
  const { sourceStart: _sourceStart, sourceEnd: _sourceEnd, ...confirmed } = candidate;
  return client.request(confirmCaptureResponseSchema, {
    method: "POST",
    path: `/v1/captures/${encodeURIComponent(capture.id)}/confirm`,
    idempotencyKey: crypto.randomUUID(),
    body: { expectedDraftVersion: capture.draftVersion, candidates: [confirmed] },
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
      const confirmed = await confirmCapture(client, capture, input.candidate);
      return confirmed.events[0] ?? null;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.overview(userId, childId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events(userId, childId) });
    },
  });
}
