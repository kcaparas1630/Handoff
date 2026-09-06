// One error shape for every external provider adapter. The provider's own error object can quote
// the request body, which for us is a transcript or audio bytes, so only this code escapes.

export type ProviderErrorCode =
  "rate_limited" | "unavailable" | "invalid_input" | "unauthorized" | "not_found";

export interface ProviderErrorInput {
  provider: string;
  code: ProviderErrorCode;
  retryable: boolean;
  /** Honoured by the job runner's backoff when the provider sent `Retry-After`. */
  retryAfterMs?: number;
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor({ provider, code, retryable, retryAfterMs }: ProviderErrorInput) {
    // The message is the code, never the provider's text: that text is not ours to repeat.
    super(`${provider}: ${code}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Maps an HTTP status onto the closed code set. Unknown 4xx is a caller error, so terminal. */
export function providerErrorForStatus(
  provider: string,
  status: number | undefined,
  retryAfterMs?: number,
): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError({ provider, code: "unauthorized", retryable: false });
  }
  if (status === 404) return new ProviderError({ provider, code: "not_found", retryable: false });
  if (status === 429) {
    return new ProviderError({
      provider,
      code: "rate_limited",
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new ProviderError({ provider, code: "invalid_input", retryable: false });
  }
  return new ProviderError({ provider, code: "unavailable", retryable: true });
}

/** `Retry-After` is either delay-seconds or an HTTP date; anything else is ignored. */
export function retryAfterMsFromHeader(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value.trim() === "") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - Date.now());
}
