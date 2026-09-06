import type { z } from "zod";
import type {
  childProfilePayloadSchema,
  idempotentResponsePayloadSchema,
  inviteePayloadSchema,
  userProfilePayloadSchema,
  workspaceProfilePayloadSchema,
} from "../schemas/profiles";

export type UserProfilePayload = z.infer<typeof userProfilePayloadSchema>;
export type WorkspaceProfilePayload = z.infer<typeof workspaceProfilePayloadSchema>;
export type ChildProfilePayload = z.infer<typeof childProfilePayloadSchema>;
export type InviteePayload = z.infer<typeof inviteePayloadSchema>;
export type IdempotentResponsePayload = z.infer<typeof idempotentResponsePayloadSchema>;
