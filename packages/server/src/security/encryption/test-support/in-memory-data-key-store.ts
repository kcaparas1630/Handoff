// Test-only DataKeyStore. Not exported from the package entrypoint.
import { randomUUID } from "node:crypto";
import type {
  DataKeyCandidate,
  DataKeyPurpose,
  DataKeyRecord,
  DataKeyState,
  DataKeyStore,
  EncryptionScope,
} from "../../../types/encryption";
import { EncryptionError } from "../errors";

export interface InMemoryDataKeyStore extends DataKeyStore {
  setState(keyId: string, state: DataKeyState): void;
  rows(): DataKeyRecord[];
}

function matchesScope(record: DataKeyRecord, scope: EncryptionScope): boolean {
  if (record.scope.kind === "workspace") {
    return scope.kind === "workspace" && record.scope.workspaceId === scope.workspaceId;
  }
  return scope.kind === "user" && record.scope.userId === scope.userId;
}

export function createInMemoryDataKeyStore(): InMemoryDataKeyStore {
  const records = new Map<string, DataKeyRecord>();

  function findActive(scope: EncryptionScope, purpose: DataKeyPurpose): DataKeyRecord | null {
    for (const record of records.values()) {
      if (record.state === "active" && record.purpose === purpose && matchesScope(record, scope)) {
        return record;
      }
    }
    return null;
  }

  return {
    findActiveKey(scope, purpose) {
      return Promise.resolve(findActive(scope, purpose));
    },

    findKeyById(id) {
      return Promise.resolve(records.get(id) ?? null);
    },

    insertActiveKeyIfAbsent(candidate: DataKeyCandidate) {
      const existing = findActive(candidate.scope, candidate.purpose);
      if (existing !== null) return Promise.resolve(existing);
      const record: DataKeyRecord = {
        id: randomUUID(),
        state: "active",
        reservedEncryptions: 0,
        ...candidate,
      };
      records.set(record.id, record);
      return Promise.resolve(record);
    },

    reserveEncryptions(keyId, count) {
      const record = records.get(keyId);
      if (record === undefined || record.state !== "active") {
        return Promise.reject(new EncryptionError("key_not_active", "cannot reserve on this key"));
      }
      record.reservedEncryptions += count;
      return Promise.resolve(record.reservedEncryptions);
    },

    setState(keyId, state) {
      const record = records.get(keyId);
      if (record === undefined) throw new Error(`unknown key ${keyId}`);
      record.state = state;
    },

    rows() {
      return [...records.values()];
    },
  };
}
