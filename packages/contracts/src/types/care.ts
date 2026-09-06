import type { z } from "zod";
import type {
  careActionRequestSchema,
  careListResponseSchema,
  careSessionDtoSchema,
  careSessionEndReasonSchema,
} from "../schemas/care";

export type CareSessionEndReason = z.infer<typeof careSessionEndReasonSchema>;
export type CareSessionDto = z.infer<typeof careSessionDtoSchema>;
export type CareActionRequest = z.infer<typeof careActionRequestSchema>;
export type CareListResponse = z.infer<typeof careListResponseSchema>;
