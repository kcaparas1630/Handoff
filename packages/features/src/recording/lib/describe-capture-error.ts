// The DTO keeps errorCode as a plain string so an older stored capture still reads back. Anything
// unrecognised falls through to a sentence that promises nothing about the cause.
const messages: Readonly<Record<string, string>> = {
  transcription_failed: "The speech could not be turned into text.",
  extraction_failed: "The words came through, but no update could be prepared from them.",
  invalid_audio: "The recording could not be read as audio.",
  upload_missing: "The recording never finished uploading.",
  provider_quota: "Handoff has reached its processing limit for now.",
  budget_exceeded: "Handoff has reached its processing limit for now.",
  crypto_failure: "This update could not be stored safely, so nothing was saved.",
  unknown: "Something went wrong while preparing this update.",
};

const fallback = "Something went wrong while preparing this update.";

/** One plain sentence for a failed capture. It never repeats a provider message or a payload. */
export function describeCaptureError(errorCode: string | null): string {
  if (errorCode === null) return fallback;
  return messages[errorCode] ?? fallback;
}

/** Codes where trying again could plausibly work; the rest offer manual entry first. */
export function canRetryCaptureError(errorCode: string | null): boolean {
  return errorCode !== "invalid_audio" && errorCode !== "upload_missing";
}
