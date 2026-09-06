// Row to DTO for stored objects. Provider, bucket, object key, and signed URLs stay server-side:
// a client identifies an asset by id and asks for a short-lived URL when it needs the bytes.
import type { MediaAssetDto } from "@handoff/contracts";
import type { MediaAssetRow } from "@handoff/db";

export function toMediaAssetDto(row: MediaAssetRow): MediaAssetDto {
  return {
    id: row.id,
    captureId: row.captureId,
    childId: row.childId,
    workspaceId: row.workspaceId,
    kind: row.kind,
    status: row.status,
    declaredMime: row.declaredMime,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}
