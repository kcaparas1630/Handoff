import type { z } from "zod";
import type {
  mediaAssetDtoSchema,
  mediaKindSchema,
  mediaStatusSchema,
  uploadAuthorizationSchema,
} from "../schemas/media";

export type MediaKind = z.infer<typeof mediaKindSchema>;
export type MediaStatus = z.infer<typeof mediaStatusSchema>;
export type MediaAssetDto = z.infer<typeof mediaAssetDtoSchema>;
export type UploadAuthorization = z.infer<typeof uploadAuthorizationSchema>;
