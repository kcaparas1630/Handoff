import { bootstrapResponseSchema, selfUserDtoSchema, workspaceDtoSchema } from "@handoff/contracts";
import type { CreateWorkspaceRequest, UpdateSelfRequest } from "@handoff/contracts";
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

/**
 * Records which processing-notice version this account accepted (architecture.md section 9).
 * The bootstrap query is the only reader of that field, so it is what gets invalidated.
 */
export function useUpdateSelf() {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateSelfRequest) =>
      client.request(selfUserDtoSchema, { method: "PATCH", path: "/v1/me", body: request }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap(userId) });
    },
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
