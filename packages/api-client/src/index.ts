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
export {
  useCapture,
  useConfirmCapture,
  useCreateTextCapture,
  useRetryCapture,
  useSaveManualEntry,
  useUpdateCaptureDraft,
} from "./captures";
export {
  completeUpload,
  confirmCapture,
  createAudioCapture,
  createTextCapture,
  getCapture,
  retryCapture,
  updateCaptureDraft,
} from "./capture-requests";
export {
  completeAssetUpload,
  createAssetUpload,
  getAssetRead,
  useAssetRead,
  useCreateAssetUpload,
} from "./media";
export {
  CAPTURE_POLL_BACKOFF_AFTER_MS,
  CAPTURE_POLL_FAST_MS,
  CAPTURE_POLL_SLOW_MS,
  capturePollInterval,
  isCaptureInProgress,
} from "./lib/capture-poll-interval";
export { useCare, useCareAction } from "./care";
export { useAcknowledgeBrief, useBrief, useCreateBrief } from "./handoffs";

export type { ApiClientProviderProps } from "./provider";
export type { RevokeInvitationVariables } from "./invitations";
export type { DeleteEventVariables, UpdateEventVariables } from "./events";
export type {
  ConfirmCaptureVariables,
  CreateTextCaptureVariables,
  SaveManualEntryInput,
  UpdateCaptureDraftVariables,
  UseCaptureOptions,
} from "./captures";
export type { CreateAudioCaptureInput } from "./capture-requests";
export type { CreateAssetUploadVariables, UseAssetReadOptions } from "./media";
export type {
  ApiClient,
  ApiClientErrorCode,
  ApiClientErrorDetails,
  ApiClientOptions,
  ApiRequestOptions,
  HttpMethod,
} from "./types/api-client";
