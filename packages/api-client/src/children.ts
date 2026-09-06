import { childCaregiverDtoSchema, childDtoSchema, cursorPage } from "@handoff/contracts";
import type { CreateChildRequest, UpdateChildCaregiversRequest } from "@handoff/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient, useApiUserId } from "./provider";
import { queryKeys } from "./query-keys";

const childPageSchema = cursorPage(childDtoSchema);
const caregiverPageSchema = cursorPage(childCaregiverDtoSchema);

export function useChildren(workspaceId: string | null) {
  const client = useApiClient();
  const userId = useApiUserId();

  return useQuery({
    queryKey: queryKeys.children(userId, workspaceId),
    enabled: userId !== null && workspaceId !== null,
    queryFn: () =>
      client.request(childPageSchema, {
        method: "GET",
        path: `/v1/workspaces/${encodeURIComponent(workspaceId ?? "")}/children`,
      }),
  });
}

export function useChild(childId: string | null) {
  const client = useApiClient();
  const userId = useApiUserId();

  return useQuery({
    queryKey: queryKeys.child(userId, childId),
    enabled: userId !== null && childId !== null,
    queryFn: () =>
      client.request(childDtoSchema, {
        method: "GET",
        path: `/v1/children/${encodeURIComponent(childId ?? "")}`,
      }),
  });
}

export function useCreateChild(workspaceId: string) {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateChildRequest) =>
      client.request(childDtoSchema, {
        method: "POST",
        path: `/v1/workspaces/${encodeURIComponent(workspaceId)}/children`,
        body: request,
      }),
    // No optimistic insert: a granted child is confirmed data (architecture.md section 7).
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.children(userId, workspaceId) });
    },
  });
}

export function useChildCaregivers(childId: string | null) {
  const client = useApiClient();
  const userId = useApiUserId();

  return useQuery({
    queryKey: queryKeys.caregivers(userId, childId),
    enabled: userId !== null && childId !== null,
    queryFn: () =>
      client.request(caregiverPageSchema, {
        method: "GET",
        path: `/v1/children/${encodeURIComponent(childId ?? "")}/caregivers`,
      }),
  });
}

export function useUpdateChildCaregivers(childId: string) {
  const client = useApiClient();
  const userId = useApiUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ expectedVersion, ...grantChanges }: UpdateChildCaregiversRequest) =>
      client.request(caregiverPageSchema, {
        method: "PATCH",
        path: `/v1/children/${encodeURIComponent(childId)}/caregivers`,
        body: grantChanges,
        expectedVersion,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.caregivers(userId, childId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.child(userId, childId) });
    },
  });
}
