import { overviewDtoSchema } from "@handoff/contracts";
import { useQuery } from "@tanstack/react-query";

import { useApiClient, useApiUserId } from "./provider";
import { queryKeys } from "./query-keys";

/**
 * The live dashboard projection. architecture.md section 7 asks for a 10 second poll on a visible
 * child plus a refresh on focus; reading it never advances a handoff cursor.
 */
export function useOverview(childId: string | null) {
  const client = useApiClient();
  const userId = useApiUserId();

  return useQuery({
    queryKey: queryKeys.overview(userId, childId),
    enabled: userId !== null && childId !== null,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    queryFn: () =>
      client.request(overviewDtoSchema, {
        method: "GET",
        path: `/v1/children/${encodeURIComponent(childId ?? "")}/overview`,
      }),
  });
}
