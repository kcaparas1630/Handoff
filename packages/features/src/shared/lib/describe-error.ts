import { isClerkAPIResponseError } from "@clerk/clerk-expo";
import { isApiClientError } from "@handoff/api-client";

const fallbackMessage = "Something went wrong. Please try again.";

/**
 * Turns any thrown value into one readable sentence. Provider objects are never rendered, so a
 * failure cannot spill request bodies, tokens, or stack traces onto the screen.
 */
export function describeError(error: unknown): string {
  if (isApiClientError(error)) return error.message;
  if (isClerkAPIResponseError(error)) {
    const first = error.errors[0];
    return first?.longMessage ?? first?.message ?? fallbackMessage;
  }
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallbackMessage;
}
