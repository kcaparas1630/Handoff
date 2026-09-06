import { bootstrapResponseSchema, workspaceDtoSchema } from "@handoff/contracts";
import type { CreateWorkspaceRequest } from "@handoff/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient, useApiUserId } from "./provider";
import { queryKeys } from "./query-keys";

/**
 * Reconciles the Clerk identity into local records and returns the workspaces the caller may open.
 * POST because the endpoint upserts the user and eligible memberships (data-contract.md section 8).
 */
export function useBootstrap() {
  const client = useApiClient();
  const userId = useApiUserId();

  return useQuery({
    queryKey: queryKeys.bootstrap(userId),
    enabled: userId !== null,
    queryFn: () =>
      client.request(bootstrapResponseSchema, { method: "POST", path: "/v1/bootstrap" }),
  });
}

export function useCreateWorkspace() {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateWorkspaceRequest) =>
      client.request(workspaceDtoSchema, {
        method: "POST",
        path: "/v1/workspaces",
        body: request,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap(userId) });
    },
  });
}
