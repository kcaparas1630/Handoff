// One Anthropic call per capture returns both the cleaned text and the event candidates, so
// neither is derived from a rewrite of the other (architecture §4). Structured output is a
// convenience, not a guarantee: the response is re-parsed and semantically validated after this.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { extractionOutputSchema } from "@handoff/contracts";
import {
  ProviderError,
  providerErrorForStatus,
  retryAfterMsFromHeader,
} from "../lib/provider-error";
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserMessage } from "./prompts/extract-events-v1";
import type { ExtractionInput } from "@handoff/contracts";
import type { ExtractionProvider, ExtractionResult } from "./extract-events";

const PROVIDER = "anthropic";

// A 60-second recording is roughly 1.5k input tokens plus 400 output tokens. At Claude Opus 5's
// $5/$25 per million that is about US$0.02 per capture, which is the whole per-recording budget
// in the milestone 3 gate once transcription is added. `output_config.effort` is left at its
// default so the evaluation measures the real cost first; the token counts recorded in the
// provenance below are what that measurement uses.
const MAX_OUTPUT_TOKENS = 4000;

export interface AnthropicExtractionOptions {
  apiKey: string;
  modelId: string;
  client?: Anthropic;
}

export function createAnthropicExtraction({
  apiKey,
  modelId,
  client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 }),
}: AnthropicExtractionOptions): ExtractionProvider {
  return {
    async extract(input: ExtractionInput): Promise<ExtractionResult> {
      const startedAt = Date.now();
      const response = await callModel(client, modelId, input);

      // A refusal and an unparsable response are both terminal: invalid output is blocked, never
      // repaired, because a repaired care fact is an invented one.
      if (response.stop_reason === "refusal" || response.parsed_output === null) {
        throw new ProviderError({ provider: PROVIDER, code: "invalid_input", retryable: false });
      }
      // Belt and braces: the helper already validated, and this is the shape we persist.
      const parsed = extractionOutputSchema.safeParse(response.parsed_output);
      if (!parsed.success) {
        throw new ProviderError({ provider: PROVIDER, code: "invalid_input", retryable: false });
      }

      return {
        output: parsed.data,
        provenance: {
          provider: PROVIDER,
          modelId,
          promptVersion: PROMPT_VERSION,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          durationMs: Date.now() - startedAt,
        },
      };
    },
  };
}

function callModel(client: Anthropic, modelId: string, input: ExtractionInput) {
  return client.messages
    .parse({
      model: modelId,
      max_tokens: MAX_OUTPUT_TOKENS,
      // The instructions are identical for every capture, so they are the cacheable prefix and
      // the volatile transcript stays behind them.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserMessage(input) }],
      output_config: { format: zodOutputFormat(extractionOutputSchema) },
    })
    .catch((error: unknown) => {
      throw toProviderError(error);
    });
}

/** The SDK error can quote the request, and our request is the transcript; only a code escapes. */
function toProviderError(error: unknown): ProviderError {
  if (error instanceof Anthropic.RateLimitError) {
    const retryAfterMs = retryAfterMsFromHeader(error.headers.get("retry-after"));
    return new ProviderError({
      provider: PROVIDER,
      code: "rate_limited",
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError({ provider: PROVIDER, code: "unavailable", retryable: true });
  }
  if (error instanceof Anthropic.APIError) {
    const status: unknown = error.status;
    return providerErrorForStatus(PROVIDER, typeof status === "number" ? status : undefined);
  }
  // AnthropicError covers a response that could not be parsed against the schema at all.
  if (error instanceof Anthropic.AnthropicError) {
    return new ProviderError({ provider: PROVIDER, code: "invalid_input", retryable: false });
  }
  return new ProviderError({ provider: PROVIDER, code: "unavailable", retryable: true });
}
