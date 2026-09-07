// Child and workspace deletion. Both endpoints answer 202: the request only marks the record
// inaccessible and enqueues the durable purge job, so there is nothing to optimistically remove
// and no completion time the client can promise (implementation-roadmap.md milestone 5).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useApiClient, useApiUserId } from "./provider";
import { queryKeys } from "./query-keys";

/**
 * The accepted-for-deletion envelope. It stays here rather than in `@handoff/contracts` because
 * the server owns the shape; if the contract later exports one, this local schema is replaced by
 * that import.
 */
const deletionAcceptedSchema = z.object({ status: z.literal("deleting") });

export type DeletionAccepted = z.infer<typeof deletionAcceptedSchema>;

export function useDeleteChild(childId: string) {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      client.request(deletionAcceptedSchema, {
        method: "DELETE",
        path: `/v1/children/${encodeURIComponent(childId)}`,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.childrenForUser(userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.child(userId, childId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.overview(userId, childId) });
    },
  });
}

export function useDeleteWorkspace(workspaceId: string) {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      client.request(deletionAcceptedSchema, {
        method: "DELETE",
        path: `/v1/workspaces/${encodeURIComponent(workspaceId)}`,
      }),
    // The workspace list itself comes from /bootstrap, so that is what has to be refetched.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap(userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.childrenForUser(userId) });
    },
  });
}
