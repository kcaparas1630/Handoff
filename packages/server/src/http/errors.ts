// Error envelope for every API response. Codes and messages never carry payload values.
import { z } from "zod";
import { apiErrorSchema } from "@handoff/contracts";
import type { ApiError, ApiErrorCode } from "@handoff/contracts";

export interface ApiHttpErrorInput {
  status: number;
  code: ApiErrorCode;
  message: string;
  retryable?: boolean;
  fieldErrors?: Record<string, string[]>;
}

/** The only error type routes and services throw on purpose. */
export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly fieldErrors: Record<string, string[]> | undefined;

  constructor({ status, code, message, retryable = false, fieldErrors }: ApiHttpErrorInput) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.fieldErrors = fieldErrors;
  }

  static unauthorized(message = "Sign in to continue"): ApiHttpError {
    return new ApiHttpError({ status: 401, code: "unauthorized", message });
  }

  static forbidden(message = "You do not have permission to do that"): ApiHttpError {
    return new ApiHttpError({ status: 403, code: "forbidden", message });
  }

  /** Unknown and unauthorized resources are indistinguishable by contract (data contract §8). */
  static notFound(message = "Not found"): ApiHttpError {
    return new ApiHttpError({ status: 404, code: "not_found", message });
  }

  static conflict(message = "This record changed since you loaded it"): ApiHttpError {
    return new ApiHttpError({ status: 409, code: "conflict", message });
  }

  static idempotencyKeyReused(message = "This idempotency key was used for a different request") {
    return new ApiHttpError({ status: 409, code: "idempotency_key_reused", message });
  }

  static validationFailed(message: string, fieldErrors?: Record<string, string[]>): ApiHttpError {
    return new ApiHttpError({
      status: 422,
      code: "validation_failed",
      message,
      ...(fieldErrors === undefined ? {} : { fieldErrors }),
    });
  }

  static providerUnavailable(message = "An upstream provider is unavailable"): ApiHttpError {
    return new ApiHttpError({
      status: 503,
      code: "provider_unavailable",
      message,
      retryable: true,
    });
  }
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.map(String).join(".") || "_";
    (fieldErrors[field] ??= []).push(issue.message);
  }
  return fieldErrors;
}

function toApiError(error: unknown, requestId: string): { status: number; body: ApiError } {
  if (error instanceof ApiHttpError) {
    return {
      status: error.status,
      body: {
        code: error.code,
        message: error.message,
        requestId,
        retryable: error.retryable,
        ...(error.fieldErrors === undefined ? {} : { fieldErrors: error.fieldErrors }),
      },
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 422,
      body: {
        code: "validation_failed",
        message: "The request body is not valid",
        requestId,
        retryable: false,
        fieldErrors: fieldErrorsFrom(error),
      },
    };
  }
  // Encryption, database, and programming failures all fail closed with one generic message.
  return {
    status: 500,
    body: { code: "internal", message: "Something went wrong", requestId, retryable: false },
  };
}

/** Builds the contract error response. Sensitive responses are never cached. */
export function toErrorResponse(error: unknown, requestId: string): Response {
  const { status, body } = toApiError(error, requestId);
  if (status >= 500) {
    // Request id and error name only: bodies and messages can contain personal data.
    console.error(
      `request ${requestId} failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
  }
  return new Response(JSON.stringify(apiErrorSchema.parse(body)), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
