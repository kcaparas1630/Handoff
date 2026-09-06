import type { InvitationStatus } from "@handoff/contracts";

// architecture.md section 3 owns the intent lifecycle; these strings only name each state honestly.
const statusLabels: Record<InvitationStatus, string> = {
  pending_send: "Waiting to send",
  sent: "Sent, waiting to be accepted",
  accepted: "Accepted",
  revoked: "Revoked",
  expired: "Expired",
  reconcile_needed: "Checking with the identity provider",
};

export function describeInvitationStatus(status: InvitationStatus): string {
  return statusLabels[status];
}

export function isRevocableStatus(status: InvitationStatus): boolean {
  return status === "pending_send" || status === "sent" || status === "reconcile_needed";
}
