import { careListResponseSchema, careSessionDtoSchema } from "@handoff/contracts";
import type { CareActionRequest } from "@handoff/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient, useApiUserId } from "./provider";
import { queryKeys } from "./query-keys";

export function useCare(childId: string | null) {
  const client = useApiClient();
  const userId = useApiUserId();

  return useQuery({
    queryKey: queryKeys.care(userId, childId),
    enabled: userId !== null && childId !== null,
    queryFn: () =>
      client.request(careListResponseSchema, {
        method: "GET",
        path: `/v1/children/${encodeURIComponent(childId ?? "")}/care`,
      }),
  });
}

/** Starts or ends the caller's own session only; another caregiver's session is untouched. */
export function useCareAction(childId: string) {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CareActionRequest) =>
      client.request(careSessionDtoSchema, {
        method: "POST",
        path: `/v1/children/${encodeURIComponent(childId)}/care`,
        body: request,
      }),
    // A session is confirmed server state, so nothing is written into the cache optimistically.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.care(userId, childId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.overview(userId, childId) });
    },
  });
}
