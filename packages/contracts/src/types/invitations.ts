import type { z } from "zod";
import type {
  createInvitationRequestSchema,
  invitationChildGrantSchema,
  invitationDetailDtoSchema,
  invitationDtoSchema,
  invitationStatusSchema,
} from "../schemas/invitations";

export type InvitationStatus = z.infer<typeof invitationStatusSchema>;
export type InvitationChildGrant = z.infer<typeof invitationChildGrantSchema>;
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;
export type InvitationDto = z.infer<typeof invitationDtoSchema>;
export type InvitationDetailDto = z.infer<typeof invitationDetailDtoSchema>;
