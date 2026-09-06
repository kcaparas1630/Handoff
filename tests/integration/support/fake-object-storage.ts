// In-memory object storage. It records what was authorized, stored, read, and deleted so a test
// can assert that the server verified the stored object rather than trusting the request body.
import { ProviderError } from "../../../packages/server/src/lib/provider-error";
import type {
  ObjectStorage,
  StoredObjectHead,
  UploadAuthorizationRequest,
  UploadAuthorizationResult,
} from "../../../packages/server/src/storage/object-storage";

export interface FakeObjectStorage extends ObjectStorage {
  /** Stands in for the client's direct PUT to the signed URL. */
  put: (objectKey: string, bytes: Buffer) => void;
  has: (objectKey: string) => boolean;
  /** Object keys, in order, that an upload authorization was signed for. */
  readonly authorized: string[];
  readonly reads: string[];
  readonly deleted: string[];
  /** When set, `readObject` fails with it; used to simulate a storage outage. */
  failReadsWith: ProviderError | null;
}

export function createFakeObjectStorage(bucket = "handoff-test"): FakeObjectStorage {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const authorized: string[] = [];
  const reads: string[] = [];
  const deleted: string[] = [];
  const contentTypes = new Map<string, string>();

  const storage: FakeObjectStorage = {
    provider: "fake",
    bucket,
    authorized,
    reads,
    deleted,
    failReadsWith: null,

    put(objectKey, bytes) {
      objects.set(objectKey, { bytes, contentType: contentTypes.get(objectKey) ?? "audio/m4a" });
    },
    has(objectKey) {
      return objects.has(objectKey);
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

    deleteObject(objectKey: string) {
      deleted.push(objectKey);
      objects.delete(objectKey);
      return Promise.resolve();
    },
  };
  return storage;
}
