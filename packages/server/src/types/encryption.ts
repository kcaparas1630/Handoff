// Authored types for application-level envelope encryption. See docs/pii-encryption.md.
import type { ciphertextEnvelopeSchema } from "../schemas/ciphertext-envelope";
import type { z } from "zod";

/** Encryption scope. Workspace content and global user profiles use separate data keys. */
export type EncryptionScope =
  { kind: "workspace"; workspaceId: string } | { kind: "user"; userId: string };

export type DataKeyPurpose = "content" | "lookup";

export type DataKeyState = "active" | "decrypt_only" | "retired";

/** Mirrors a `data_keys` row. Raw key bytes are never part of this record. */
export interface DataKeyRecord {
  id: string;
  scope: EncryptionScope;
  purpose: DataKeyPurpose;
  version: number;
  wrappedKey: Uint8Array;
  wrappingProvider: string;
  wrappingKeyRef: string;
  wrappingContextVersion: number;
  state: DataKeyState;
  reservedEncryptions: number;
}

/** Key-service binding metadata. Contains no plaintext personal information. */
export interface WrappingContext {
  scope: EncryptionScope;
  purpose: DataKeyPurpose;
  contextVersion: number;
}

export interface WrappedKeyMaterial {
  wrappedKey: Uint8Array;
  wrappingKeyRef: string;
}

/** Adapter over the external key service that wraps and unwraps raw data keys. */
export interface KeyWrapper {
  provider: string;
  wrap(rawKey: Uint8Array, wrappingContext: WrappingContext): Promise<WrappedKeyMaterial>;
  unwrap(wrappedKey: Uint8Array, wrappingContext: WrappingContext): Promise<Uint8Array>;
}

/** A new key proposed for a scope/purpose that has no active key yet. */
export interface DataKeyCandidate {
  scope: EncryptionScope;
  purpose: DataKeyPurpose;
  version: number;
  wrappedKey: Uint8Array;
  wrappingProvider: string;
  wrappingKeyRef: string;
  wrappingContextVersion: number;
}

/**
 * Persistence port implemented by the db package. The store owns single-active-per-scope
 * semantics and the atomic usage reservation; this package never issues SQL.
 */
export interface DataKeyStore {
  findActiveKey(scope: EncryptionScope, purpose: DataKeyPurpose): Promise<DataKeyRecord | null>;
  findKeyById(id: string): Promise<DataKeyRecord | null>;
  /** Returns the winning row, which may be another writer's key. */
  insertActiveKeyIfAbsent(candidate: DataKeyCandidate): Promise<DataKeyRecord>;
  /** Returns the new reserved total; fails when the row is not active. */
  reserveEncryptions(keyId: string, count: number): Promise<number>;
}

/** Row identity bound into AAD. Composite primary keys pass their ordered key parts. */
export interface RecordContext {
  table: string;
  rowId: string | string[];
  column: string;
}

export interface EncryptionKeyMaterial {
  keyId: string;
  key: Buffer;
}

export type CiphertextEnvelope = z.infer<typeof ciphertextEnvelopeSchema>;
