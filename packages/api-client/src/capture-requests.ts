import {
  captureDtoSchema,
  completeUploadResponseSchema,
  confirmCaptureResponseSchema,
  retryCaptureResponseSchema,
} from "@handoff/contracts";
import type {
  CaptureDto,
  CompleteUploadRequest,
  CompleteUploadResponse,
  ConfirmCaptureResponse,
  ConfirmedCandidate,
  CreateCaptureAudio,
  DraftCandidate,
  RetryCaptureResponse,
} from "@handoff/contracts";

import type { ApiClient } from "./types/api-client";

/**
 * Plain capture requests, without React. The durable upload outbox runs outside the component
 * tree (architecture.md section 7), so it calls these directly instead of through a hook.
 */

type CaptureContext = {
  childId: string;
  /** Client-generated and stable across retries; doubles as the create idempotency key. */
  clientCaptureId: string;
  capturedAt: string;
  timezone: string;
  locale: string;
  careSessionId?: string | undefined;
};

export type CreateAudioCaptureInput = CaptureContext & { audio: CreateCaptureAudio };

export type CreateTextCaptureInput = CaptureContext & { text: string };

function contextBody(context: CaptureContext): Record<string, unknown> {
  return {
    childId: context.childId,
    clientCaptureId: context.clientCaptureId,
    capturedAt: context.capturedAt,
    timezone: context.timezone,
    locale: context.locale,
    ...(context.careSessionId === undefined ? {} : { careSessionId: context.careSessionId }),
  };
}

/** Allocates the capture and its one-time upload authorization. The URL is never persisted. */
export function createAudioCapture(
  client: ApiClient,
  input: CreateAudioCaptureInput,
): Promise<CaptureDto> {
  return client.request(captureDtoSchema, {
    method: "POST",
    path: "/v1/captures",
    idempotencyKey: input.clientCaptureId,
    body: { ...contextBody(input), inputKind: "audio", audio: input.audio },
  });
}

/** Typed entry. The server queues extraction immediately because there is nothing to upload. */
export function createTextCapture(
  client: ApiClient,
  input: CreateTextCaptureInput,
): Promise<CaptureDto> {
  return client.request(captureDtoSchema, {
    method: "POST",
    path: "/v1/captures",
    idempotencyKey: input.clientCaptureId,
    body: { ...contextBody(input), inputKind: "text", text: input.text },
  });
}

/**
 * Reads one capture. While it is still `awaiting_upload` the author's response carries a fresh
 * upload authorization, which is how a resumed outbox row recovers from an expired signed URL.
 */
export function getCapture(client: ApiClient, captureId: string): Promise<CaptureDto> {
  return client.request(captureDtoSchema, {
    method: "GET",
    path: `/v1/captures/${encodeURIComponent(captureId)}`,
  });
}

/** Reports what was actually uploaded. The server verifies the stored object before queueing. */
export function completeUpload(
  client: ApiClient,
  captureId: string,
  body: CompleteUploadRequest,
  idempotencyKey: string,
): Promise<CompleteUploadResponse> {
  return client.request(completeUploadResponseSchema, {
    method: "POST",
    path: `/v1/captures/${encodeURIComponent(captureId)}/complete`,
    idempotencyKey,
    body: { ...body },
  });
}

export function retryCapture(
  client: ApiClient,
  captureId: string,
  idempotencyKey: string,
): Promise<RetryCaptureResponse> {
  return client.request(retryCaptureResponseSchema, {
    method: "POST",
    path: `/v1/captures/${encodeURIComponent(captureId)}/retry`,
    idempotencyKey,
  });
}

/** Saves review edits without publishing anything; the draft version guards a stale screen. */
export function updateCaptureDraft(
  client: ApiClient,
  captureId: string,
  expectedDraftVersion: number,
  candidates: readonly DraftCandidate[],
): Promise<CaptureDto> {
  return client.request(captureDtoSchema, {
    method: "PATCH",
    path: `/v1/captures/${encodeURIComponent(captureId)}`,
    idempotencyKey: crypto.randomUUID(),
    body: { expectedDraftVersion, candidates: [...candidates] },
  });
}

// Source spans stay server-side, so a client cannot repoint a confirmed event at other text.
function withoutSourceSpans(candidate: DraftCandidate): ConfirmedCandidate {
  const { sourceStart: _sourceStart, sourceEnd: _sourceEnd, ...confirmed } = candidate;
  return confirmed;
}

/** The sole publication path. It never runs without an explicit tap by the reviewer. */
export function confirmCapture(
  client: ApiClient,
  captureId: string,
  expectedDraftVersion: number,
  candidates: readonly DraftCandidate[],
): Promise<ConfirmCaptureResponse> {
  return client.request(confirmCaptureResponseSchema, {
    method: "POST",
    path: `/v1/captures/${encodeURIComponent(captureId)}/confirm`,
    idempotencyKey: crypto.randomUUID(),
    body: { expectedDraftVersion, candidates: candidates.map(withoutSourceSpans) },
  });
}
