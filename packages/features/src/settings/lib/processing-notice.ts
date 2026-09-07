// The plain-language statement of what leaves the phone, and the version stored on the account.
//
// architecture.md section 9 requires showing this before voice is first enabled and storing the
// accepted version. Changing any wording below means changing the version: an account that
// accepted an older text has not seen the new one, and the app asks again.
import type { ProcessingNoticePoint } from "../types/processing-notice";

export const PROCESSING_NOTICE_VERSION = "2026-09-notice-1";

export const PROCESSING_NOTICE_TITLE = "What leaves your phone";

export const PROCESSING_NOTICE_SUMMARY =
  "Recording an update, or typing one, sends it to companies outside Handoff so it can be turned " +
  "into entries you review. Quick entry does not: those buttons stay on Handoff's own servers.";

export const PROCESSING_NOTICE_POINTS: readonly ProcessingNoticePoint[] = [
  {
    id: "audio",
    heading: "Recordings go to a transcription company",
    body:
      "When you tap Record, the audio is uploaded to Handoff and sent to our speech-to-text " +
      "provider to be written out. It hears whatever you said, including a child's name.",
  },
  {
    id: "text",
    heading: "The words go to an AI company",
    body:
      "The written-out recording, or the sentence you type under Type instead, is sent to our AI " +
      "provider so it can suggest entries. It suggests only; nothing is saved to the journal " +
      "until you review and confirm it.",
  },
  {
    id: "photos",
    heading: "Photos and videos go to private storage",
    body:
      "Files you attach are stored privately for Handoff and are not sent to the transcription or " +
      "AI providers. Nobody without access to that child can open them.",
  },
  {
    id: "quick-entry",
    heading: "Quick entry stays here",
    body:
      "Feed, sleep, diaper, and milestone buttons write straight to the journal. No outside " +
      "company sees them, so they remain available whether or not you accept this.",
  },
  {
    id: "deletion",
    heading: "Deleting is not instant everywhere",
    body:
      "Deleting a child removes its entries, photos, and briefs from Handoff. Our providers keep " +
      "their own copies for their own retention periods, which we cannot shorten for you.",
  },
];

/** True when this account has accepted exactly the version of the notice this build shows. */
export function hasAcceptedProcessingNotice(acceptedVersion: string | null | undefined): boolean {
  return acceptedVersion === PROCESSING_NOTICE_VERSION;
}
