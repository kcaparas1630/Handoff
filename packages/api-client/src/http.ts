import { apiErrorSchema } from "@handoff/contracts";
import type { ApiError } from "@handoff/contracts";
import type { ZodType } from "zod";

import type {
  ApiClient,
  ApiClientErrorCode,
  ApiClientErrorDetails,
  ApiClientOptions,
  ApiRequestOptions,
} from "./types/api-client";

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

const networkMessage = "Could not reach Handoff. Check the connection and try again.";
const unreadableMessage = "Handoff sent a response this app version cannot read.";

export class ApiClientError extends Error {
  readonly code: ApiClientErrorCode;
  readonly status: number | null;
  /** The parsed error envelope when the server sent one; null for transport or schema failures. */
  readonly apiError: ApiError | null;

  constructor(code: ApiClientErrorCode, message: string, details: ApiClientErrorDetails = {}) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = details.status ?? null;
    this.apiError = details.apiError ?? null;
  }

  get requestId(): string | null {
    return this.apiError?.requestId ?? null;
  }

  get retryable(): boolean {
    return this.apiError?.retryable ?? false;
  }

  get fieldErrors(): Record<string, string[]> | null {
    return this.apiError?.fieldErrors ?? null;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions): ApiClient {
  const origin = baseUrl.replace(/\/+$/, "");

  async function request<Value>(
    schema: ZodType<Value>,
    options: ApiRequestOptions,
  ): Promise<Value> {
    const token = await getToken();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token !== null) headers.Authorization = `Bearer ${token}`;

    const payload = buildPayload(options);
    if (payload !== null) headers["Content-Type"] = "application/json";
    // data-contract.md section 8: every state-changing request carries a client-generated UUID.
    if (options.method !== "GET") {
      headers["Idempotency-Key"] = options.idempotencyKey ?? crypto.randomUUID();
    }

    const url = `${origin}${options.path}`;
    let response: FetchResponse;
    try {
      response = await fetch(
        url,
        payload === null
          ? { method: options.method, headers }
          : { method: options.method, headers, body: payload },
      );
    } catch {
      // The thrown transport object can echo the URL and headers, so only a fixed message escapes.
      throw new ApiClientError("network_unavailable", networkMessage);
    }

    const rawBody = await readJsonBody(response);
    if (!response.ok) throw toResponseError(response.status, rawBody);

    const parsed = schema.safeParse(rawBody);
    if (!parsed.success) {
      throw new ApiClientError("invalid_response", unreadableMessage, { status: response.status });
    }
    return parsed.data;
  }

  return { request };
}

function buildPayload({ body, expectedVersion }: ApiRequestOptions): string | null {
  if (body === undefined && expectedVersion === undefined) return null;
  if (expectedVersion === undefined) return JSON.stringify(body);
  return JSON.stringify({ ...body, expectedVersion });
}

async function readJsonBody(response: FetchResponse): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toResponseError(status: number, rawBody: unknown): ApiClientError {
  const parsed = apiErrorSchema.safeParse(rawBody);
  if (!parsed.success) {
    return new ApiClientError("invalid_response", unreadableMessage, { status });
  }
  return new ApiClientError(parsed.data.code, parsed.data.message, {
    status,
    apiError: parsed.data,
  });
}
