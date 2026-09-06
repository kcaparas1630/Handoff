import { describe, expect, it } from "vitest";
import { loadServerEnv, ServerEnvError } from "./env";

const developmentSource = {
  NODE_ENV: "development",
  CLERK_SECRET_KEY: "sk_test_value",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_value",
  CLERK_GUARDIAN_ROLE_KEY: "org:guardian",
  DATABASE_URL: "postgres://user:pass@localhost:5432/handoff",
  PII_KEY_PROVIDER: "development",
  PII_DEV_WRAPPING_KEY_B64: "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFy",
  INVITATION_REDIRECT_URL: "https://handoff.test/accept-invitation",
  APP_LINK_PARENTS: "https://handoff.test/parents",
  APP_LINK_DAYCARE: "https://handoff.test/daycare",
};

function loadError(source: Record<string, string | undefined>): ServerEnvError {
  try {
    loadServerEnv(source);
  } catch (error) {
    if (error instanceof ServerEnvError) return error;
    throw error;
  }
  throw new Error("expected the configuration to be rejected");
}

describe("loadServerEnv", () => {
  it("normalizes a valid development configuration", () => {
    const env = loadServerEnv(developmentSource);
    expect(env.piiKeyProvider).toBe("development");
    expect(env.clerkGuardianRoleKey).toBe("org:guardian");
    expect(env.piiKmsKeyId).toBeNull();
  });

  it("names each missing variable without echoing any value", () => {
    const error = loadError({ ...developmentSource, CLERK_SECRET_KEY: undefined });
    expect(error.variables).toContain("CLERK_SECRET_KEY");
    expect(error.message).toContain("CLERK_SECRET_KEY");
    expect(error.message).not.toContain(developmentSource.DATABASE_URL);
  });

  it("requires the key reference and region for the kms provider", () => {
    const error = loadError({
      ...developmentSource,
      PII_KEY_PROVIDER: "kms",
      PII_DEV_WRAPPING_KEY_B64: undefined,
    });
    expect(error.variables).toEqual(expect.arrayContaining(["PII_KMS_KEY_ID", "AWS_REGION"]));
  });

  it("rejects the development wrapping adapter in production", () => {
    const error = loadError({ ...developmentSource, NODE_ENV: "production" });
    expect(error.variables).toContain("PII_KEY_PROVIDER");
  });

  it("accepts a production configuration that uses the managed key service", () => {
    const env = loadServerEnv({
      ...developmentSource,
      NODE_ENV: "production",
      PII_KEY_PROVIDER: "kms",
      PII_KMS_KEY_ID: "arn:aws:kms:us-west-2:000000000000:key/handoff",
      AWS_REGION: "us-west-2",
      PII_DEV_WRAPPING_KEY_B64: undefined,
    });
    expect(env.piiKeyProvider).toBe("kms");
    expect(env.awsRegion).toBe("us-west-2");
  });
});
