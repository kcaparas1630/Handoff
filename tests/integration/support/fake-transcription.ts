// Stands in for Deepgram. The stored bytes are the transcript, so each test capture carries its
// own text and the call count proves whether a retry paid for transcription again.
import type {
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResult,
} from "../../../packages/server/src/transcription/provider";

export interface FakeTranscription extends TranscriptionProvider {
  /** How many times the provider was actually called. */
  readonly state: { calls: number };
  failWith: (error: unknown | null) => void;
  failOnce: (error: unknown) => void;
}

export function createFakeTranscription(modelId = "nova-test"): FakeTranscription {
  const state = { calls: 0 };
  let failure: unknown | null = null;
  let failureOnce: unknown | null = null;

  return {
    state,
    failWith(error) {
      failure = error;
    },
    failOnce(error) {
      failureOnce = error;
    },
    transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
      state.calls += 1;
      if (failureOnce !== null) {
        const error = failureOnce;
        failureOnce = null;
        return Promise.reject(error);
      }
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve({
        transcript: request.audio.toString("utf8"),
        durationMs: 3_000,
        provider: "deepgram",
        modelId,
        requestId: `req_${String(state.calls)}`,
      });
    },
  };
}
