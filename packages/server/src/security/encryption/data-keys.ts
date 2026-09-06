// Resolves scoped data keys: provisioning, usage reservation, and a bounded memory cache.
import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import type {
  DataKeyPurpose,
  DataKeyRecord,
  DataKeyState,
  DataKeyStore,
  EncryptionKeyMaterial,
  EncryptionScope,
  KeyWrapper,
} from "../../types/encryption";
import { EncryptionError } from "./errors";

const DATA_KEY_BYTES = 32;
const WRAPPING_CONTEXT_VERSION = 1;
const FIRST_KEY_VERSION = 1;

export interface DataKeyServiceOptions {
  store: DataKeyStore;
  wrapper: KeyWrapper;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  encryptionBudget?: number;
  now?: () => number;
}

export interface DataKeyService {
  /** Content keys only; a lookup key must never reach AES-GCM. */
  getEncryptionKey(scope: EncryptionScope): Promise<EncryptionKeyMaterial>;
  getDecryptionKey(keyId: string, expectedScope: EncryptionScope): Promise<Buffer>;
  /** Keyed HMAC index key. Reads need it too, so it consumes no encryption budget. */
  getLookupKey(scope: EncryptionScope): Promise<EncryptionKeyMaterial>;
}

/** The cache holds unwrapped bytes only; scope and state are always read from the store. */
interface CacheEntry {
  key: Buffer;
  expiresAt: number;
}

function isSameScope(left: EncryptionScope, right: EncryptionScope): boolean {
  if (left.kind === "workspace") {
    return right.kind === "workspace" && left.workspaceId === right.workspaceId;
  }
  return right.kind === "user" && left.userId === right.userId;
}

export function createDataKeyService({
  store,
  wrapper,
  cacheTtlMs = 60_000,
  maxCacheEntries = 256,
  encryptionBudget = 1_000_000,
  now = Date.now,
}: DataKeyServiceOptions): DataKeyService {
  const cache = new Map<string, CacheEntry>();

  function readCache(keyId: string): CacheEntry | undefined {
    const entry = cache.get(keyId);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now()) {
      cache.delete(keyId);
      return undefined;
    }
    return entry;
  }

  function writeCache(keyId: string, key: Buffer): void {
    cache.delete(keyId);
    if (cache.size >= maxCacheEntries) {
      const oldest = cache.keys().next();
      if (oldest.done !== true) cache.delete(oldest.value);
    }
    cache.set(keyId, { key, expiresAt: now() + cacheTtlMs });
  }

  async function wrapRawKey(rawKey: Buffer, scope: EncryptionScope, purpose: DataKeyPurpose) {
    try {
      return await wrapper.wrap(rawKey, {
        scope,
        purpose,
        contextVersion: WRAPPING_CONTEXT_VERSION,
      });
    } catch (error) {
      if (error instanceof EncryptionError) throw error;
      throw new EncryptionError("wrapper_failure", "could not wrap a new data key");
    }
  }

  async function unwrapRecord(record: DataKeyRecord): Promise<Buffer> {
    const cached = readCache(record.id);
    if (cached !== undefined) return cached.key;
    let rawKey: Uint8Array;
    try {
      rawKey = await wrapper.unwrap(record.wrappedKey, {
        scope: record.scope,
        purpose: record.purpose,
        contextVersion: record.wrappingContextVersion,
      });
    } catch (error) {
      if (error instanceof EncryptionError) throw error;
      throw new EncryptionError("wrapper_failure", "could not unwrap the stored data key");
    }
    const key = Buffer.from(rawKey);
    if (key.length !== DATA_KEY_BYTES) {
      throw new EncryptionError("invalid_key", "unwrapped data key is not 256 bits");
    }
    writeCache(record.id, key);
    return key;
  }

  async function provisionActiveKey(
    scope: EncryptionScope,
    purpose: DataKeyPurpose,
  ): Promise<{ record: DataKeyRecord; key: Buffer }> {
    const candidateKey = randomBytes(DATA_KEY_BYTES);
    const wrapped = await wrapRawKey(candidateKey, scope, purpose);
    const winner = await store.insertActiveKeyIfAbsent({
      scope,
      purpose,
      version: FIRST_KEY_VERSION,
      wrappedKey: wrapped.wrappedKey,
      wrappingProvider: wrapper.provider,
      wrappingKeyRef: wrapped.wrappingKeyRef,
      wrappingContextVersion: WRAPPING_CONTEXT_VERSION,
    });
    assertActiveForScope(winner, scope);
    // Another writer may have won the race; discard our unpersisted candidate in that case.
    if (Buffer.from(winner.wrappedKey).equals(Buffer.from(wrapped.wrappedKey))) {
      writeCache(winner.id, candidateKey);
      return { record: winner, key: candidateKey };
    }
    return { record: winner, key: await unwrapRecord(winner) };
  }

  /** Validates the row before unwrapping it, so a stale or foreign key is never unwrapped. */
  async function resolveActiveKey(
    scope: EncryptionScope,
    purpose: DataKeyPurpose,
  ): Promise<EncryptionKeyMaterial> {
    const active = await store.findActiveKey(scope, purpose);
    if (active === null) {
      const provisioned = await provisionActiveKey(scope, purpose);
      return { keyId: provisioned.record.id, key: provisioned.key };
    }
    assertActiveForScope(active, scope);
    return { keyId: active.id, key: await unwrapRecord(active) };
  }

  return {
    async getEncryptionKey(scope) {
      const material = await resolveActiveKey(scope, "content");
      const reserved = await store.reserveEncryptions(material.keyId, 1);
      if (reserved > encryptionBudget) {
        // Rotation is a later milestone; until then, stop rather than exceed the budget.
        throw new EncryptionError(
          "budget_exceeded",
          "the active data key reached its usage budget",
        );
      }
      return material;
    },

    getLookupKey(scope) {
      // HMAC lookups have no nonce budget, so no usage is reserved here.
      return resolveActiveKey(scope, "lookup");
    },

    async getDecryptionKey(keyId, expectedScope) {
      const record = await store.findKeyById(keyId);
      if (record === null) {
        throw new EncryptionError("key_unavailable", "no data key exists for this envelope");
      }
      assertUsableForDecryption(record.scope, record.state, expectedScope);
      return unwrapRecord(record);
    },
  };
}

/** A decrypt-only or foreign key must never be selected for new ciphertext or index values. */
function assertActiveForScope(record: DataKeyRecord, scope: EncryptionScope): void {
  if (!isSameScope(record.scope, scope)) {
    throw new EncryptionError("key_scope_mismatch", "the resolved key belongs to another scope");
  }
  if (record.state !== "active") {
    throw new EncryptionError("key_not_active", "the resolved key is not active");
  }
}

/** Scope is checked before state so a cross-tenant key never reaches the cipher. */
function assertUsableForDecryption(
  keyScope: EncryptionScope,
  state: DataKeyState,
  expectedScope: EncryptionScope,
): void {
  if (!isSameScope(keyScope, expectedScope)) {
    throw new EncryptionError("key_scope_mismatch", "the key belongs to another scope");
  }
  if (state === "retired") {
    throw new EncryptionError("key_unavailable", "the key is retired");
  }
}
