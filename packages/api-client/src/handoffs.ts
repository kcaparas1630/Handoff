import { acknowledgeBriefResponseSchema, handoffBriefDtoSchema } from "@handoff/contracts";
import type { AcknowledgeBriefRequest } from "@handoff/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient, useApiUserId } from "./provider";
import { queryKeys } from "./query-keys";

/**
 * Creates the recipient-specific bounded snapshot. Generating or reading a brief is not an
 * acknowledgement (architecture.md section 5), so nothing here advances the caller's cursor.
 */
export function useCreateBrief(childId: string) {
  const client = useApiClient();

  return useMutation({
    mutationFn: () =>
      client.request(handoffBriefDtoSchema, {
        method: "POST",
        path: `/v1/children/${encodeURIComponent(childId)}/handoffs`,
      }),
  });
}

/** Re-reads the snapshot so revoked sources and newer changes surface while the brief is open. */
export function useBrief(briefId: string | null) {
  const client = useApiClient();
  const userId = useApiUserId();

  return useQuery({
    queryKey: queryKeys.brief(userId, briefId),
    enabled: userId !== null && briefId !== null,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    queryFn: () =>
      client.request(handoffBriefDtoSchema, {
        method: "GET",
        path: `/v1/handoffs/${encodeURIComponent(briefId ?? "")}`,
      }),
  });
}

export function useAcknowledgeBrief(briefId: string) {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: AcknowledgeBriefRequest) =>
      client.request(acknowledgeBriefResponseSchema, {
        method: "POST",
        path: `/v1/handoffs/${encodeURIComponent(briefId)}/acknowledge`,
        body: request,
      }),
    // An acknowledgement is never shown before the server records it (architecture.md section 7).
    onSuccess: async ({ brief }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.brief(userId, brief.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.overview(userId, brief.childId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.care(userId, brief.childId) });
    },
  });
}
