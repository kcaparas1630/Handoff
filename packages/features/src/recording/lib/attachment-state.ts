import type { AttachmentStage, OutboxAttachment } from "@handoff/mobile";
import type { AttachmentTileStatus } from "@handoff/ui";

/**
 * Turns one queued attachment into the tile state a caregiver can trust. Nothing here can produce
 * `ready`: only a validated asset with a freshly signed URL is shown as a picture.
 */
export function attachmentTileStatus(
  row: Pick<OutboxAttachment, "kind" | "stage" | "lastErrorCode">,
): AttachmentTileStatus {
  if (row.stage === "failed") {
    return { state: "failed", kind: row.kind, message: describeStageFailure(row.lastErrorCode) };
  }
  // The bytes are only Handoff's until the upload is accepted; before that the file is local.
  if (isOnThisPhone(row.stage)) return { state: "local", kind: row.kind };
  return { state: "pending", kind: row.kind };
}

function isOnThisPhone(stage: AttachmentStage): boolean {
  return stage === "saved_locally" || stage === "asset_created";
}

/** Short, non-technical reasons. Provider payloads and signed URLs never reach the screen. */
export function describeStageFailure(errorCode: string | null): string {
  if (errorCode === "attachment_authorization_expired") {
    return "the upload window closed before it finished";
  }
  if (errorCode === "forbidden" || errorCode === "unauthorized") {
    return "you no longer have access to this child";
  }
  if (errorCode === "not_found") return "this update is no longer on the server";
  if (errorCode === "validation_failed") return "the file was refused";
  return "it could not be sent";
}
