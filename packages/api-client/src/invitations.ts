import { cursorPage, invitationDtoSchema } from "@handoff/contracts";
import type { CreateInvitationRequest } from "@handoff/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient, useApiUserId } from "./provider";
import { queryKeys } from "./query-keys";

const invitationPageSchema = cursorPage(invitationDtoSchema);

// data-contract.md section 8 names POST /workspaces/:id/invitations and GET/DELETE
// /invitations/:id. The invitations screen also needs to list a workspace's intents, so this
// package reads the same collection with GET; see the task report for that resolution.
export function useInvitations(workspaceId: string | null) {
  const client = useApiClient();
  const userId = useApiUserId();

  return useQuery({
    queryKey: queryKeys.invitations(userId, workspaceId),
    enabled: userId !== null && workspaceId !== null,
    queryFn: () =>
      client.request(invitationPageSchema, {
        method: "GET",
        path: `/v1/workspaces/${encodeURIComponent(workspaceId ?? "")}/invitations`,
      }),
  });
}

export function useCreateInvitation(workspaceId: string) {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateInvitationRequest) =>
      client.request(invitationDtoSchema, {
        method: "POST",
        path: `/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
        body: request,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations(userId, workspaceId) });
    },
  });
}

export type RevokeInvitationVariables = {
  invitationId: string;
  /** Carried so the workspace's invitation list can be invalidated after the server responds. */
  workspaceId: string;
};

export function useRevokeInvitation() {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ invitationId }: RevokeInvitationVariables) =>
      client.request(invitationDtoSchema, {
        method: "DELETE",
        path: `/v1/invitations/${encodeURIComponent(invitationId)}`,
      }),
    onSuccess: async (_invitation, { workspaceId }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations(userId, workspaceId) });
    },
  });
}
