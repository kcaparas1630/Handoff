// Stands in for the Anthropic adapter. By default it answers with the labelled fixture whose
// transcript matches, so the pipeline tests assert against the corpus rather than against
// hand-written model output. Failures are injected as the same errors the real adapter raises.
import { loadExtractionCases, outputForCase } from "./extraction-cases";
import type { ExtractionInput, ExtractionOutput } from "../../../packages/contracts/src/index";
import type {
  ExtractionProvider,
  ExtractionResult,
} from "../../../packages/server/src/ai/extract-events";

export interface FakeExtraction extends ExtractionProvider {
  readonly calls: ExtractionInput[];
  /** Overrides the answer for one transcript. */
  script: (transcript: string, output: ExtractionOutput) => void;
  /** Thrown on every call until cleared; `once` throws only on the next call. */
  failWith: (error: unknown | null) => void;
  failOnce: (error: unknown) => void;
}

export function createFakeExtraction(modelId = "claude-test"): FakeExtraction {
  const calls: ExtractionInput[] = [];
  const scripted = new Map<string, ExtractionOutput>();
  const byTranscript = new Map<string, ExtractionOutput>();
  let failure: unknown | null = null;
  let failureOnce: unknown | null = null;

  for (const fixture of loadExtractionCases().values()) {
    byTranscript.set(fixture.transcript, outputForCase(fixture));
  }

  return {
    calls,
    script(transcript, output) {
      scripted.set(transcript, output);
    },
    failWith(error) {
      failure = error;
    },
    failOnce(error) {
      failureOnce = error;
    },
    extract(input: ExtractionInput): Promise<ExtractionResult> {
      calls.push(input);
      if (failureOnce !== null) {
        const error = failureOnce;
        failureOnce = null;
        return Promise.reject(error);
      }
      if (failure !== null) return Promise.reject(failure);

      const output = scripted.get(input.rawTranscript) ??
        byTranscript.get(input.rawTranscript) ?? {
          schemaVersion: 1,
          formattedText: input.rawTranscript,
          candidates: [],
          notes: [],
        };
      return Promise.resolve({
        output,
        provenance: {
          provider: "anthropic",
          modelId,
          promptVersion: input.promptVersion,
          inputTokens: 1500,
          outputTokens: 400,
          durationMs: 10,
        },
      });
    },
  };
}
