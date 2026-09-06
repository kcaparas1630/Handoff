// A read that decrypts many rows at once resolves the same data key for every one of them, and
// each resolution is a database round trip. This wrapper resolves it once per request instead.
// Scope and key state are still verified by the underlying service; they are simply verified once
// for this request rather than once per row, so nothing outlives the request that asked for it.
import type { Buffer } from "node:buffer";
import type { DataKeyService } from "./encryption/data-keys";
import type { EncryptionScope } from "../types/encryption";

function scopeKey(scope: EncryptionScope): string {
  return scope.kind === "workspace" ? `workspace:${scope.workspaceId}` : `user:${scope.userId}`;
}

export function withRequestKeyCache(keys: DataKeyService): DataKeyService {
  const pending = new Map<string, Promise<Buffer>>();
  return {
    // Encryption reserves usage per call, so it is never cached.
    getEncryptionKey: (scope) => keys.getEncryptionKey(scope),
    getLookupKey: (scope) => keys.getLookupKey(scope),
    getDecryptionKey: (keyId, expectedScope) => {
      const cacheKey = `${keyId}:${scopeKey(expectedScope)}`;
      const existing = pending.get(cacheKey);
      if (existing !== undefined) return existing;
      // The promise itself is cached, so concurrent decrypts share one resolution, and a failed
      // resolution stays failed for this request rather than being retried per row.
      const resolution = keys.getDecryptionKey(keyId, expectedScope);
      pending.set(cacheKey, resolution);
      return resolution;
    },
  };
}
