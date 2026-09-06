import { z } from "zod";
import { versionSchema } from "./api-envelope";
import { appRoleSchema, caregiverRelationshipSchema, childPermissionSchema } from "./identity";

export const invitationStatusSchema = z.enum([
  "pending_send",
  "sent",
  "accepted",
  "revoked",
  "expired",
  "reconcile_needed",
]);

export const invitationChildGrantSchema = z.object({
  childId: z.uuid(),
  relationship: caregiverRelationshipSchema,
  permission: childPermissionSchema,
});

// The one email normalization policy: trim then lowercase, before format validation.
// The server's invitation lookup HMAC must be computed over exactly this canonical form,
// otherwise a resend would create a second pending intent for the same person.
export const inviteeEmailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const createInvitationRequestSchema = z.object({
  email: inviteeEmailSchema,
  intendedAppRole: appRoleSchema,
  childGrants: z.array(invitationChildGrantSchema).min(1),
});

// No invitee email here: the invitation list is readable by more people than the address should be.
export const invitationDtoSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  intendedAppRole: appRoleSchema,
  status: invitationStatusSchema,
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  childGrants: z.array(invitationChildGrantSchema),
  version: versionSchema,
});

// Owner-facing detail read only; adds the address needed to manage or resend an invitation.
export const invitationDetailDtoSchema = invitationDtoSchema.extend({
  inviteeEmail: z.email(),
});
