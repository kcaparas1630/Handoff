// Production wrapping adapter. The KMS client is injected so tests never reach AWS.
import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
import type { KMSClient } from "@aws-sdk/client-kms";
import type { KeyWrapper, WrappedKeyMaterial, WrappingContext } from "../../types/encryption";
import { encodeWrappingContext } from "./lib/encryption-context";
import { EncryptionError } from "./errors";

export function createKmsKeyWrapper({
  client,
  keyId,
}: {
  client: KMSClient;
  keyId: string;
}): KeyWrapper {
  return {
    provider: "aws-kms",

    async wrap(rawKey: Uint8Array, wrappingContext: WrappingContext): Promise<WrappedKeyMaterial> {
      let wrappedKey: Uint8Array | undefined;
      try {
        const result = await client.send(
          new EncryptCommand({
            KeyId: keyId,
            Plaintext: rawKey,
            EncryptionContext: encodeWrappingContext(wrappingContext),
          }),
        );
        wrappedKey = result.CiphertextBlob;
      } catch {
        // Never surface the SDK error or the request; it can carry key material.
        throw new EncryptionError("wrapper_failure", "key service rejected the wrap request");
      }
      if (wrappedKey === undefined) {
        throw new EncryptionError("wrapper_failure", "key service returned no wrapped key");
      }
      return { wrappedKey, wrappingKeyRef: keyId };
    },

    async unwrap(wrappedKey: Uint8Array, wrappingContext: WrappingContext): Promise<Uint8Array> {
      let rawKey: Uint8Array | undefined;
      try {
        const result = await client.send(
          new DecryptCommand({
            KeyId: keyId,
            CiphertextBlob: wrappedKey,
            EncryptionContext: encodeWrappingContext(wrappingContext),
          }),
        );
        rawKey = result.Plaintext;
      } catch {
        throw new EncryptionError("wrapper_failure", "key service rejected the unwrap request");
      }
      if (rawKey === undefined) {
        throw new EncryptionError("wrapper_failure", "key service returned no data key");
      }
      return rawKey;
    },
  };
}
