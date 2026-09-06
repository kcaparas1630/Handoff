import {
  assetReadResponseSchema,
  completeAssetUploadResponseSchema,
  createAssetUploadResponseSchema,
} from "@handoff/contracts";
import type {
  AssetReadResponse,
  CompleteUploadRequest,
  CompleteUploadResponse,
  CreateAssetUploadRequest,
  CreateAssetUploadResponse,
} from "@handoff/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useApiClient, useApiUserId } from "./provider";
import { queryKeys } from "./query-keys";
import type { ApiClient } from "./types/api-client";

/**
 * Image and video attachments. The upload itself goes straight to storage from the outbox, so the
 * three request functions are plain and React-free; only reading a signed URL needs a hook.
 */

// A read URL is treated as unusable this long before its stated expiry, so a slow render cannot
// start loading bytes with an authorization that dies mid-request.
const expiryGuardMs = 5_000;

// architecture.md section 6: a signed URL is never an identifier. It is dropped from memory soon
// after the last viewer unmounts and is never written to disk.
const readGcTimeMs = 30_000;

/** Allocates one attachment on an existing capture and its one-time upload authorization. */
export function createAssetUpload(
  client: ApiClient,
  captureId: string,
  body: CreateAssetUploadRequest,
  idempotencyKey: string,
): Promise<CreateAssetUploadResponse> {
  return client.request(createAssetUploadResponseSchema, {
    method: "POST",
    path: `/v1/captures/${encodeURIComponent(captureId)}/assets`,
    idempotencyKey,
    body: { ...body },
  });
}

/** Reports what was actually stored. Validation runs server-side; this never publishes anything. */
export function completeAssetUpload(
  client: ApiClient,
  assetId: string,
  body: CompleteUploadRequest,
  idempotencyKey: string,
): Promise<CompleteUploadResponse> {
  return client.request(completeAssetUploadResponseSchema, {
    method: "POST",
    path: `/v1/assets/${encodeURIComponent(assetId)}/complete`,
    idempotencyKey,
    body: { ...body },
  });
}

/**
 * Asks for a short-lived read URL after a fresh authorization check. The server answers 404 until
 * the asset is ready, so an unvalidated upload can never be rendered as a picture.
 */
export function getAssetRead(client: ApiClient, assetId: string): Promise<AssetReadResponse> {
  return client.request(assetReadResponseSchema, {
    method: "GET",
    path: `/v1/assets/${encodeURIComponent(assetId)}`,
  });
}

export type UseAssetReadOptions = { enabled?: boolean };

/**
 * One ready attachment's bytes. The entry goes stale exactly when its URL expires, so a viewer
 * that is shown again after that point refetches instead of loading a dead link.
 */
export function useAssetRead(assetId: string | null, options: UseAssetReadOptions = {}) {
  const client = useApiClient();
  const userId = useApiUserId();

  return useQuery({
    queryKey: queryKeys.asset(userId, assetId),
    enabled: userId !== null && assetId !== null && options.enabled !== false,
    staleTime: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      if (expiresAt === undefined) return 0;
      return Math.max(0, Date.parse(expiresAt) - Date.now() - expiryGuardMs);
    },
    gcTime: readGcTimeMs,
    // A 404 means "not ready yet", and a 403 means "not yours"; neither improves by asking again.
    retry: false,
    queryFn: () => getAssetRead(client, assetId ?? ""),
  });
}

export type CreateAssetUploadVariables = CreateAssetUploadRequest & {
  /** Stable across retries of the same attachment; the outbox row id is used for it. */
  idempotencyKey: string;
};

/** Used by screens that allocate an attachment directly; the outbox calls the plain function. */
export function useCreateAssetUpload(captureId: string) {
  const client = useApiClient();

  return useMutation({
    mutationFn: ({ idempotencyKey, ...body }: CreateAssetUploadVariables) =>
      createAssetUpload(client, captureId, body, idempotencyKey),
  });
}
