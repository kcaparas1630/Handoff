// Deepgram prerecorded transcription. The capture `locale` is formatting context, never proof of
// the spoken language, so the requested language is pinned to the enabled English baseline
// (docs/architecture-questions.md §1).
import { DeepgramClient, DeepgramError, DeepgramTimeoutError } from "@deepgram/sdk";
import { ProviderError, providerErrorForStatus } from "../lib/provider-error";
import type { TranscriptionProvider, TranscriptionRequest, TranscriptionResult } from "./provider";

const PROVIDER = "deepgram";

export interface DeepgramTranscriptionOptions {
  apiKey: string;
  modelId: string;
  client?: DeepgramClient;
}

export function createDeepgramTranscription({
  apiKey,
  modelId,
  // Bounded so a stalled provider call cannot outlive the job lease that authorizes its writes.
  client = new DeepgramClient({ apiKey, timeoutInSeconds: 60, maxRetries: 2 }),
}: DeepgramTranscriptionOptions): TranscriptionProvider {
  return {
    async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
      const response = await callDeepgram(client, request, modelId);
      // The accepted response shape belongs to callback requests, which this adapter never makes.
      if (!("results" in response)) {
        throw new ProviderError({ provider: PROVIDER, code: "unavailable", retryable: true });
      }
      const alternative = response.results.channels[0]?.alternatives?.[0];
      const duration = response.metadata.duration;
      return {
        // Silence is a valid outcome: it produces an empty transcript and zero candidates.
        transcript: alternative?.transcript ?? "",
        durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
        provider: PROVIDER,
        modelId,
        requestId: response.metadata.request_id,
      };
    },
  };
}

async function callDeepgram(
  client: DeepgramClient,
  request: TranscriptionRequest,
  modelId: string,
) {
  try {
    return await client.listen.v1.media.transcribeFile(
      { data: request.audio, contentType: request.mime, contentLength: request.audio.byteLength },
      {
        model: modelId,
        language: request.language,
        smart_format: true,
        punctuate: true,
      },
    );
  } catch (error) {
    throw toProviderError(error);
  }
}

/** The SDK error carries the response body, which quotes the audio request; only a code escapes. */
function toProviderError(error: unknown): ProviderError {
  if (error instanceof DeepgramTimeoutError) {
    return new ProviderError({ provider: PROVIDER, code: "unavailable", retryable: true });
  }
  if (error instanceof DeepgramError) {
    return providerErrorForStatus(PROVIDER, error.statusCode);
  }
  return new ProviderError({ provider: PROVIDER, code: "unavailable", retryable: true });
}
