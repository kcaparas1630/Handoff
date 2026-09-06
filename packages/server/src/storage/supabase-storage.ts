// Supabase private bucket adapter. Signed URLs are returned to their one caller and never
// logged, stored, or replayed from an idempotency record (docs/pii-encryption.md).
import { createClient } from "@supabase/supabase-js";
import { ProviderError, providerErrorForStatus } from "../lib/provider-error";
import type {
  ObjectStorage,
  StoredObjectHead,
  UploadAuthorizationRequest,
  UploadAuthorizationResult,
} from "./object-storage";

const PROVIDER = "supabase";

// Supabase issues upload tokens with a fixed two-hour lifetime; the API cannot shorten the
// signature itself, so it advertises the shorter window it actually wants clients to use and
// never advertises longer than the provider will honour.
const PROVIDER_UPLOAD_TTL_SECONDS = 7200;

interface StorageFailure {
  message: string;
  status?: number | undefined;
}

function toProviderError(error: StorageFailure): ProviderError {
  return providerErrorForStatus(PROVIDER, error.status);
}

function isMissingObject(error: StorageFailure): boolean {
  if (error.status === 404) return true;
  // The storage API answers a missing object with 400 "Object not found" on some routes, so the
  // status alone is not enough to tell "gone" from "rejected".
  return /not.?found/i.test(error.message);
}

export interface SupabaseStorageOptions {
  url: string;
  secretKey: string;
  bucket: string;
}

export function createSupabaseStorage({
  url,
  secretKey,
  bucket,
}: SupabaseStorageOptions): ObjectStorage {
  // No session persistence: this is a server credential, not a signed-in user.
  const files = createClient(url, secretKey, { auth: { persistSession: false } }).storage.from(
    bucket,
  );

  return {
    provider: PROVIDER,
    bucket,

    async createUploadAuthorization(
      request: UploadAuthorizationRequest,
    ): Promise<UploadAuthorizationResult> {
      // No upsert: the token authorizes exactly the allocated object once (architecture §6).
      const { data, error } = await files.createSignedUploadUrl(request.objectKey);
      if (error !== null) throw toProviderError(error);
      const seconds = Math.min(request.expiresInSeconds, PROVIDER_UPLOAD_TTL_SECONDS);
      return {
        url: data.signedUrl,
        headers: { "x-upsert": "false", "content-type": request.contentType },
        expiresAt: new Date(Date.now() + seconds * 1000),
      };
    },

    async headObject(objectKey: string): Promise<StoredObjectHead | null> {
      const { data, error } = await files.info(objectKey);
      if (error !== null) {
        if (isMissingObject(error)) return null;
        throw toProviderError(error);
      }
      return { sizeBytes: data.size ?? 0, contentType: data.contentType ?? null };
    },

    async createReadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
      const { data, error } = await files.createSignedUrl(objectKey, expiresInSeconds);
      if (error !== null) throw toProviderError(error);
      return data.signedUrl;
    },

    async readObject(objectKey: string, maxBytes: number): Promise<Buffer> {
      const head = await this.headObject(objectKey);
      if (head === null) {
        throw new ProviderError({ provider: PROVIDER, code: "not_found", retryable: false });
      }
      if (head.sizeBytes > maxBytes) {
        throw new ProviderError({ provider: PROVIDER, code: "invalid_input", retryable: false });
      }
      const { data, error } = await files.download(objectKey);
      if (error !== null) throw toProviderError(error);
      const bytes = Buffer.from(await data.arrayBuffer());
      // The head is a separate request, so the bytes are checked again rather than trusted.
      if (bytes.byteLength > maxBytes) {
        throw new ProviderError({ provider: PROVIDER, code: "invalid_input", retryable: false });
      }
      return bytes;
    },

    async deleteObject(objectKey: string): Promise<void> {
      const { error } = await files.remove([objectKey]);
      if (error === null || isMissingObject(error)) return;
      throw toProviderError(error);
    },
  };
}
