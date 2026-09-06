// One factory for the whole server. There is no service locator and no module-level singleton.
import { KMSClient } from "@aws-sdk/client-kms";
import { createDataKeyStore, createDbClient } from "@handoff/db";
import { createClerkGateway } from "./auth/clerk";
import { createDataKeyService } from "./security/encryption/data-keys";
import { createDevelopmentKeyWrapper } from "./security/encryption/development-key-wrapper";
import { createKmsKeyWrapper } from "./security/encryption/kms-key-wrapper";
import type { ServerEnv } from "./types/server-env";
import type { ServerRuntime, ServiceDeps } from "./types/runtime";
import type { KeyWrapper } from "./types/encryption";

const MAX_DB_CONNECTIONS = 10;

/**
 * Key resolution runs on its own small pool. Every encrypted write resolves its data key while a
 * tenant transaction already holds a connection, so sharing one pool lets concurrent writers wait
 * on each other forever once the pool is full.
 */
const MAX_KEY_CONNECTIONS = 4;

function createKeyWrapper(env: ServerEnv): KeyWrapper {
  if (env.piiKeyProvider === "development") {
    if (env.piiDevWrappingKeyB64 === null) {
      throw new Error("PII_DEV_WRAPPING_KEY_B64 is required for the development key provider");
    }
    return createDevelopmentKeyWrapper(env.piiDevWrappingKeyB64);
  }
  if (env.piiKmsKeyId === null || env.awsRegion === null) {
    throw new Error("PII_KMS_KEY_ID and AWS_REGION are required for the kms key provider");
  }
  return createKmsKeyWrapper({
    client: new KMSClient({ region: env.awsRegion }),
    keyId: env.piiKmsKeyId,
  });
}

export function createServerRuntime(env: ServerEnv): ServerRuntime {
  const client = createDbClient({ url: env.databaseUrl, maxConnections: MAX_DB_CONNECTIONS });
  const keyClient = createDbClient({ url: env.databaseUrl, maxConnections: MAX_KEY_CONNECTIONS });
  const keyWrapper = createKeyWrapper(env);
  return {
    db: client.db,
    keyWrapper,
    keys: createDataKeyService({ store: createDataKeyStore(keyClient.db), wrapper: keyWrapper }),
    clerk: createClerkGateway({
      secretKey: env.clerkSecretKey,
      webhookSigningSecret: env.clerkWebhookSigningSecret,
      ...(env.clerkAuthorizedParties === null
        ? {}
        : { authorizedParties: env.clerkAuthorizedParties }),
    }),
    guardianRoleKey: env.clerkGuardianRoleKey,
    invitationRedirectUrl: env.invitationRedirectUrl,
    now: () => new Date(),
    close: async () => {
      await client.close();
      await keyClient.close();
    },
  };
}

/** Binds the request id that audit rows and error responses carry. */
export function createRequestDeps(runtime: ServerRuntime, requestId: string): ServiceDeps {
  return {
    db: runtime.db,
    keys: runtime.keys,
    keyWrapper: runtime.keyWrapper,
    clerk: runtime.clerk,
    guardianRoleKey: runtime.guardianRoleKey,
    invitationRedirectUrl: runtime.invitationRedirectUrl,
    now: runtime.now,
    requestId,
  };
}
