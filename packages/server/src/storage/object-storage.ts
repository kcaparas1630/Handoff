// The object storage port named in the milestone 3 file list. Use cases hand it a key they
// generated (lib/object-key.ts) and it signs, reads, or deletes exactly that object. It has no
// opinion about captures, and no adapter may log a signed URL (architecture §6).

export interface UploadAuthorizationRequest {
  objectKey: string;
  contentType: string;
  /** Refused above this size by the provider as well as by the API. */
  maxBytes: number;
  expiresInSeconds: number;
}

export interface UploadAuthorizationResult {
  url: string;
  /** Sent verbatim by the client with its PUT; they are part of what the signature covers. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StoredObjectHead {
  sizeBytes: number;
  contentType: string | null;
}

/** One entry of a prefix listing, which is how cleanup finds objects no asset row claims. */
export interface StoredObjectSummary {
  objectKey: string;
  sizeBytes: number;
}

export interface ObjectStorage {
  readonly provider: string;
  readonly bucket: string;
  createUploadAuthorization(
    request: UploadAuthorizationRequest,
  ): Promise<UploadAuthorizationResult>;
  /** Null when the object does not exist, which is how an unfinished upload is detected. */
  headObject(objectKey: string): Promise<StoredObjectHead | null>;
  createReadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  /** Worker only. Refuses anything larger than `maxBytes` instead of buffering it. */
  readObject(objectKey: string, maxBytes: number): Promise<Buffer>;
  /**
   * Worker only. Writes server-produced bytes, such as a normalized image, to a key the server
   * generated. Never an upsert: the caller deletes first when it means to replace an object.
   */
  putObject(objectKey: string, bytes: Buffer, contentType: string): Promise<void>;
  /**
   * Worker only. Objects stored under `prefix`, bounded by `limit`. Reconciliation needs it
   * because an upload that never reported completion leaves an object no database row names.
   */
  listObjects(prefix: string, limit: number): Promise<StoredObjectSummary[]>;
  /** Idempotent: deleting an object that is already gone is a success. */
  deleteObject(objectKey: string): Promise<void>;
}
