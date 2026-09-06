// Pure mapping from stored invitation rows to the transport DTO.
import type { InvitationDto } from "@handoff/contracts";
import type { InvitationChildGrantRow, InvitationIntentRow } from "@handoff/db";

// The invitee address is deliberately absent: the list is readable by more people than the
// address should be. Only the owner-facing detail read adds it.
export function toInvitationDto(
  intent: InvitationIntentRow,
  grants: InvitationChildGrantRow[],
): InvitationDto {
  return {
    id: intent.id,
    workspaceId: intent.workspaceId,
    intendedAppRole: intent.intendedAppRole,
    status: intent.status,
    expiresAt: intent.expiresAt.toISOString(),
    acceptedAt: intent.acceptedAt === null ? null : intent.acceptedAt.toISOString(),
    childGrants: grants.map((grant) => ({
      childId: grant.childId,
      relationship: grant.relationship,
      permission: grant.permission,
    })),
    version: intent.version,
  };
}
