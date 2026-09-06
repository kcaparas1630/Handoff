// These must stay structurally compatible with the server's DataKeyStore port in
// packages/server/src/types/encryption.ts; db must not depend on the server package.

export type DataKeyScope =
  { kind: "workspace"; workspaceId: string } | { kind: "user"; userId: string };

export type DataKeyPurpose = "content" | "lookup";

export type DataKeyState = "active" | "decrypt_only" | "retired";

/** A `data_keys` row. Raw key bytes are never stored or returned. */
export interface DataKeyRow {
  id: string;
  scope: DataKeyScope;
  purpose: DataKeyPurpose;
  version: number;
  wrappedKey: Uint8Array;
  wrappingProvider: string;
  wrappingKeyRef: string;
  wrappingContextVersion: number;
  state: DataKeyState;
  reservedEncryptions: number;
}

/** A key proposed for a scope/purpose that may not have an active key yet. */
export interface NewDataKey {
  scope: DataKeyScope;
  purpose: DataKeyPurpose;
  version: number;
  wrappedKey: Uint8Array;
  wrappingProvider: string;
  wrappingKeyRef: string;
  wrappingContextVersion: number;
}

export interface DataKeyStorePort {
  findActiveKey(scope: DataKeyScope, purpose: DataKeyPurpose): Promise<DataKeyRow | null>;
  findKeyById(id: string): Promise<DataKeyRow | null>;
  insertActiveKeyIfAbsent(candidate: NewDataKey): Promise<DataKeyRow>;
  reserveEncryptions(keyId: string, count: number): Promise<number>;
}
