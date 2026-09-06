// Authenticated transport and typed query/mutation hooks. No React Native imports live here.

export { ApiClientError, createApiClient, isApiClientError } from "./http";
export { ApiClientProvider, useApiClient, useApiUserId } from "./provider";
export { queryKeys } from "./query-keys";

export { useBootstrap, useCreateWorkspace } from "./identity";
export {
  useChild,
  useChildCaregivers,
  useChildren,
  useCreateChild,
  useUpdateChildCaregivers,
} from "./children";
export { useCreateInvitation, useInvitations, useRevokeInvitation } from "./invitations";
export { useOverview } from "./overview";
export { useDeleteEvent, useEvents, useUpdateEvent } from "./events";
export { useSaveManualEntry } from "./captures";
export { useCare, useCareAction } from "./care";
export { useAcknowledgeBrief, useBrief, useCreateBrief } from "./handoffs";

export type { ApiClientProviderProps } from "./provider";
export type { RevokeInvitationVariables } from "./invitations";
export type { DeleteEventVariables, UpdateEventVariables } from "./events";
export type { SaveManualEntryInput } from "./captures";
export type {
  ApiClient,
  ApiClientErrorCode,
  ApiClientErrorDetails,
  ApiClientOptions,
  ApiRequestOptions,
  HttpMethod,
} from "./types/api-client";
