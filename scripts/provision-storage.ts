// Creates the private recording bucket, reproducibly. Run with `pnpm storage:provision` against a
// development project. It prints what it did and never prints a credential or an object key.
//
// The bucket limits duplicate the product limits on purpose: the server enforces them before it
// signs anything, and the provider enforces them again on the upload itself (architecture §6).
import {
  AUDIO_MIME_TYPES,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
} from "../packages/contracts/src/index";
import { loadServerEnv, requireStorageEnv, ServerEnvError } from "../packages/server/src/index";
import { createClient } from "@supabase/supabase-js";

/** Above every product limit and below the provider's own free-plan maximum. */
const FILE_SIZE_LIMIT = "20MB";

const ALLOWED_MIME_TYPES = [...AUDIO_MIME_TYPES, ...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES];

async function main(): Promise<void> {
  const storage = requireStorageEnv(loadServerEnv(process.env));
  const client = createClient(storage.url, storage.secretKey, {
    auth: { persistSession: false },
  });

  const existing = await client.storage.getBucket(storage.bucket);
  if (existing.data !== null) {
    console.info(`bucket "${storage.bucket}" already exists; no change made`);
    console.info(`  public: ${String(existing.data.public)}`);
    return;
  }

  const created = await client.storage.createBucket(storage.bucket, {
    // Private: every read goes through a fresh authorized signature (architecture §6).
    public: false,
    fileSizeLimit: FILE_SIZE_LIMIT,
    allowedMimeTypes: [...ALLOWED_MIME_TYPES],
  });
  if (created.error !== null) {
    console.error(`could not create bucket "${storage.bucket}": ${created.error.message}`);
    process.exit(1);
  }
  console.info(`created private bucket "${storage.bucket}"`);
  console.info(`  file size limit: ${FILE_SIZE_LIMIT}`);
  console.info(`  allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`);
}

main().catch((error: unknown) => {
  if (error instanceof ServerEnvError) {
    console.error(`storage configuration is incomplete: ${error.variables.join(", ")}`);
    process.exit(78);
  }
  console.error(`provisioning failed: ${error instanceof Error ? error.name : "UnknownError"}`);
  process.exit(1);
});
