// In-memory object storage. It records what was authorized, stored, read, and deleted so a test
// can assert that the server verified the stored object rather than trusting the request body.
import { ProviderError } from "../../../packages/server/src/lib/provider-error";
import type {
  ObjectStorage,
  StoredObjectHead,
  StoredObjectSummary,
  UploadAuthorizationRequest,
  UploadAuthorizationResult,
} from "../../../packages/server/src/storage/object-storage";

export interface FakeObjectStorage extends ObjectStorage {
  /**
   * Stands in for the client's direct PUT to the signed URL. Like the provider, it refuses to
   * overwrite an object that already exists, because the authorization forbids upsert.
   */
  put: (objectKey: string, bytes: Buffer, contentType?: string) => void;
  has: (objectKey: string) => boolean;
  read: (objectKey: string) => Buffer | null;
  /** Every key currently stored, so a test can assert nothing was left behind. */
  keys: () => string[];
  /** Object keys, in order, that an upload authorization was signed for. */
  readonly authorized: string[];
  readonly reads: string[];
  readonly deleted: string[];
  /** Object keys, in order, that the server wrote directly; normalized photos land here. */
  readonly written: string[];
  /** Object keys a read URL was signed for. The URL itself is never asserted on. */
  readonly readUrls: string[];
  /** When set, `readObject` fails with it; used to simulate a storage outage. */
  failReadsWith: ProviderError | null;
}

export function createFakeObjectStorage(bucket = "handoff-test"): FakeObjectStorage {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const authorized: string[] = [];
  const reads: string[] = [];
  const deleted: string[] = [];
  const written: string[] = [];
  const readUrls: string[] = [];
  const contentTypes = new Map<string, string>();

  const storage: FakeObjectStorage = {
    provider: "fake",
    bucket,
    authorized,
    reads,
    deleted,
    written,
    readUrls,
    failReadsWith: null,

    put(objectKey, bytes, contentType) {
      // `x-upsert: false`: a second PUT under the same authorization is refused, as it is by the
      // provider, so an overwrite attempt cannot replace bytes the worker already validated.
      if (objects.has(objectKey)) {
        throw new ProviderError({ provider: "fake", code: "invalid_input", retryable: false });
      }
      objects.set(objectKey, {
        bytes,
        contentType: contentType ?? contentTypes.get(objectKey) ?? "audio/m4a",
      });
    },
    has(objectKey) {
      return objects.has(objectKey);
    },
    read(objectKey) {
      return objects.get(objectKey)?.bytes ?? null;
    },
    keys() {
      return [...objects.keys()].sort();
    },

    createUploadAuthorization(request: UploadAuthorizationRequest) {
      authorized.push(request.objectKey);
      contentTypes.set(request.objectKey, request.contentType);
      const result: UploadAuthorizationResult = {
        url: `https://storage.test/upload/${encodeURIComponent(request.objectKey)}`,
        headers: { "x-upsert": "false", "content-type": request.contentType },
        expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
      };
      return Promise.resolve(result);
    },

    headObject(objectKey: string) {
      const stored = objects.get(objectKey);
      const head: StoredObjectHead | null =
        stored === undefined
          ? null
          : { sizeBytes: stored.bytes.byteLength, contentType: stored.contentType };
      return Promise.resolve(head);
    },

    createReadUrl(objectKey: string) {
      readUrls.push(objectKey);
      return Promise.resolve(`https://storage.test/read/${encodeURIComponent(objectKey)}`);
    },

    readObject(objectKey: string, maxBytes: number) {
      reads.push(objectKey);
      if (storage.failReadsWith !== null) return Promise.reject(storage.failReadsWith);
      const stored = objects.get(objectKey);
      if (stored === undefined) {
        return Promise.reject(
          new ProviderError({ provider: "fake", code: "not_found", retryable: false }),
        );
      }
      if (stored.bytes.byteLength > maxBytes) {
        return Promise.reject(
          new ProviderError({ provider: "fake", code: "invalid_input", retryable: false }),
        );
      }
      return Promise.resolve(stored.bytes);
    },

    putObject(objectKey: string, bytes: Buffer, contentType: string) {
      written.push(objectKey);
      try {
        storage.put(objectKey, bytes, contentType);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error("put failed"));
      }
      return Promise.resolve();
    },

    listObjects(prefix: string, limit: number) {
      const summaries: StoredObjectSummary[] = [...objects.entries()]
        .filter(([objectKey]) => objectKey.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, limit)
        .map(([objectKey, stored]) => ({ objectKey, sizeBytes: stored.bytes.byteLength }));
      return Promise.resolve(summaries);
    },

    deleteObject(objectKey: string) {
      deleted.push(objectKey);
      objects.delete(objectKey);
      return Promise.resolve();
    },
  };
  return storage;
}
