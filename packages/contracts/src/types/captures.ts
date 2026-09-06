import type { z } from "zod";
import type {
  captureAmbiguitySchema,
  captureDraftSchema,
  captureDtoSchema,
  captureErrorCodeSchema,
  captureInputKindSchema,
  captureStatusSchema,
  completeUploadRequestSchema,
  completeUploadResponseSchema,
  confirmCaptureRequestSchema,
  confirmCaptureResponseSchema,
  confirmedCandidateSchema,
  createCaptureAudioSchema,
  createCaptureInputKindSchema,
  createCaptureRequestSchema,
  draftCandidateSchema,
  retryCaptureResponseSchema,
  updateCaptureDraftRequestSchema,
} from "../schemas/captures";

export type CaptureInputKind = z.infer<typeof captureInputKindSchema>;
export type CreateCaptureInputKind = z.infer<typeof createCaptureInputKindSchema>;
export type CaptureStatus = z.infer<typeof captureStatusSchema>;
export type CaptureErrorCode = z.infer<typeof captureErrorCodeSchema>;
export type CaptureAmbiguity = z.infer<typeof captureAmbiguitySchema>;
export type DraftCandidate = z.infer<typeof draftCandidateSchema>;
export type ConfirmedCandidate = z.infer<typeof confirmedCandidateSchema>;
export type CaptureDraft = z.infer<typeof captureDraftSchema>;
export type CaptureDto = z.infer<typeof captureDtoSchema>;
export type CreateCaptureRequest = z.infer<typeof createCaptureRequestSchema>;
export type UpdateCaptureDraftRequest = z.infer<typeof updateCaptureDraftRequestSchema>;
export type ConfirmCaptureRequest = z.infer<typeof confirmCaptureRequestSchema>;
export type ConfirmCaptureResponse = z.infer<typeof confirmCaptureResponseSchema>;
export type CreateCaptureAudio = z.infer<typeof createCaptureAudioSchema>;
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;
export type CompleteUploadResponse = z.infer<typeof completeUploadResponseSchema>;
export type RetryCaptureResponse = z.infer<typeof retryCaptureResponseSchema>;
