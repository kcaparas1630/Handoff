import type { MediaCleanupState, MediaKind, MediaStatus } from "./enums";

export interface MediaAssetRow {
  id: string;
  workspaceId: string;
  childId: string;
  captureId: string;
  uploadedByUserId: string;
  kind: MediaKind;
  storageProvider: string;
  bucket: string;
  objectKey: string;
  declaredMime: string;
  verifiedMime: string | null;
  reservedBytes: number;
  sizeBytes: number | null;
  durationMs: number | null;
  checksum: string | null;
  status: MediaStatus;
  cleanupState: MediaCleanupState;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** The id is allocated by the caller because the object key embeds it. */
export interface NewMediaAsset {
  id: string;
  workspaceId: string;
  childId: string;
  captureId: string;
  uploadedByUserId: string;
  kind: MediaKind;
  storageProvider: string;
  bucket: string;
  objectKey: string;
  declaredMime: string;
  reservedBytes: number;
  expiresAt?: Date | null;
}

/** What the completion callback reports after the client finished its direct upload. */
export interface MediaUploadResult {
  workspaceId: string;
  assetId: string;
  expectedVersion: number;
  sizeBytes: number;
  checksum?: string | null;
  durationMs?: number | null;
}

export interface MediaAssetLookup {
  storageProvider: string;
  bucket: string;
  objectKey: string;
}

/** The three counters that decide whether another upload token may be issued. */
export interface WorkspaceStorageRow {
  workspaceId: string;
  budgetBytes: number;
  reservedBytes: number;
  usedBytes: number;
}
