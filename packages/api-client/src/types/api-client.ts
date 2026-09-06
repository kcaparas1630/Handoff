import type { ApiError, ApiErrorCode } from "@handoff/contracts";
import type { ZodType } from "zod";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiRequestOptions = {
  method: HttpMethod;
  /** Path below the API origin, including the version prefix, for example `/v1/bootstrap`. */
  path: string;
  body?: Record<string, unknown> | undefined;
  /** Defaults to a fresh UUID on state-changing methods; supply one to repeat the same operation. */
  idempotencyKey?: string | undefined;
  /** Merged into the JSON body because the contracts schemas declare it as a body field. */
  expectedVersion?: number | undefined;
};

/**
 * Server envelope codes plus the two failures the client itself detects: a body that does not
 * match the contract schema, and a request that never reached the API.
 */
export type ApiClientErrorCode = ApiErrorCode | "invalid_response" | "network_unavailable";

export type ApiClientErrorDetails = {
  status?: number | undefined;
  apiError?: ApiError | undefined;
};

export type ApiClientOptions = {
  baseUrl: string;
  /** Resolves the current Clerk session token, or null when nobody is signed in. */
  getToken: () => Promise<string | null>;
};

export type ApiClient = {
  request: <Value>(schema: ZodType<Value>, options: ApiRequestOptions) => Promise<Value>;
};
