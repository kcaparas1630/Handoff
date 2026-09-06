import type { z } from "zod";
import type {
  mediaAssetDtoSchema,
  mediaKindSchema,
  mediaStatusSchema,
  uploadAuthorizationSchema,
  attachmentKindSchema,
  assetReadResponseSchema,
  createAssetUploadRequestSchema,
  createAssetUploadResponseSchema,
} from "../schemas/media";

export type MediaKind = z.infer<typeof mediaKindSchema>;
export type MediaStatus = z.infer<typeof mediaStatusSchema>;
export type MediaAssetDto = z.infer<typeof mediaAssetDtoSchema>;
export type UploadAuthorization = z.infer<typeof uploadAuthorizationSchema>;
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;
export type CreateAssetUploadRequest = z.infer<typeof createAssetUploadRequestSchema>;
export type CreateAssetUploadResponse = z.infer<typeof createAssetUploadResponseSchema>;
export type AssetReadResponse = z.infer<typeof assetReadResponseSchema>;
