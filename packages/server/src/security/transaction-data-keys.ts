// A data key service bound to one open transaction.
//
// `data_keys.workspace_id` and `data_keys.user_id` are foreign keys, so the very first key for a
// scope cannot be provisioned on another pooled connection before the workspace or user row is
// committed. Bootstrap and workspace initialization therefore insert the row and provision its
// key inside the same transaction; every later write uses the long-lived shared service.
import { dataKeyRepository } from "@handoff/db";
import type { HandoffTransaction } from "@handoff/db";
import { createDataKeyService } from "./encryption/data-keys";
import type { DataKeyService } from "./encryption/data-keys";
import type { DataKeyStore, KeyWrapper } from "../types/encryption";

export function createTransactionDataKeyStore(tx: HandoffTransaction): DataKeyStore {
  return {
    findActiveKey: (scope, purpose) => dataKeyRepository.findActiveDataKey(tx, scope, purpose),
    findKeyById: (id) => dataKeyRepository.findDataKeyById(tx, id),
    insertActiveKeyIfAbsent: (candidate) =>
      dataKeyRepository.insertActiveDataKeyIfAbsent(tx, candidate),
    reserveEncryptions: (keyId, count) =>
      dataKeyRepository.reserveDataKeyEncryptions(tx, keyId, count),
  };
}

export function createTransactionDataKeyService(
  tx: HandoffTransaction,
  wrapper: KeyWrapper,
): DataKeyService {
  return createDataKeyService({ store: createTransactionDataKeyStore(tx), wrapper });
}
