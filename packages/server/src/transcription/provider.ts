// The transcription port named in the milestone 3 file list. It returns text and provenance and
// nothing else: no database access, no capture knowledge, no storage paths.

export interface TranscriptionRequest {
  audio: Buffer;
  mime: string;
  /** English is the only enabled baseline (docs/architecture-questions.md §1). */
  language: "en";
}

export interface TranscriptionResult {
  transcript: string;
  durationMs: number | null;
  provider: string;
  modelId: string;
  /** For correlating a provider support request without keeping the audio or the text. */
  requestId: string | null;
}

export interface TranscriptionProvider {
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}
