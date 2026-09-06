// Startup configuration contract. Messages name the variable and never echo its value.
import { z } from "zod";

const requiredSecret = (name: string) =>
  z.string({ error: `${name} is required` }).min(1, `${name} must not be empty`);

function isAbsoluteUrl(value: string): boolean {
  try {
    return new URL(value).protocol !== "";
  } catch {
    return false;
  }
}

const absoluteUrl = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .min(1, `${name} must not be empty`)
    .refine(isAbsoluteUrl, `${name} must be an absolute URL`);

/** An empty or whitespace-only setting is treated as absent rather than as "accept nothing". */
function splitAuthorizedParties(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const parties = value
    .split(",")
    .map((party) => party.trim())
    .filter((party) => party !== "");
  return parties.length === 0 ? null : parties;
}

const rawServerEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  CLERK_SECRET_KEY: requiredSecret("CLERK_SECRET_KEY"),
  CLERK_WEBHOOK_SIGNING_SECRET: requiredSecret("CLERK_WEBHOOK_SIGNING_SECRET"),
  CLERK_GUARDIAN_ROLE_KEY: requiredSecret("CLERK_GUARDIAN_ROLE_KEY"),
  // Comma separated list of accepted token `azp` values; omitted leaves Clerk's default.
  CLERK_AUTHORIZED_PARTIES: z.string().min(1).optional(),
  DATABASE_URL: requiredSecret("DATABASE_URL"),
  PII_KEY_PROVIDER: z.enum(["kms", "development"], {
    error: 'PII_KEY_PROVIDER must be "kms" or "development"',
  }),
  PII_KMS_KEY_ID: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
  PII_DEV_WRAPPING_KEY_B64: z.string().min(1).optional(),
  INVITATION_REDIRECT_URL: absoluteUrl("INVITATION_REDIRECT_URL"),
  APP_LINK_PARENTS: absoluteUrl("APP_LINK_PARENTS"),
  APP_LINK_DAYCARE: absoluteUrl("APP_LINK_DAYCARE"),
});

/**
 * Validates the server/worker environment and normalizes it to a camelCase object.
 * The development wrapping adapter is rejected in production so real data cannot be
 * written under a local key; see docs/pii-encryption.md "Keys and access".
 */
export const serverEnvSchema = rawServerEnvSchema
  .superRefine((value, ctx) => {
    if (value.PII_KEY_PROVIDER === "kms") {
      if (value.PII_KMS_KEY_ID === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["PII_KMS_KEY_ID"],
          message: 'PII_KMS_KEY_ID is required when PII_KEY_PROVIDER is "kms"',
        });
      }
      if (value.AWS_REGION === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["AWS_REGION"],
          message: 'AWS_REGION is required when PII_KEY_PROVIDER is "kms"',
        });
      }
      return;
    }
    if (value.NODE_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["PII_KEY_PROVIDER"],
        message: 'PII_KEY_PROVIDER must be "kms" when NODE_ENV is "production"',
      });
    }
    if (value.PII_DEV_WRAPPING_KEY_B64 === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["PII_DEV_WRAPPING_KEY_B64"],
        message: 'PII_DEV_WRAPPING_KEY_B64 is required when PII_KEY_PROVIDER is "development"',
      });
    }
  })
  .transform((value) => ({
    nodeEnv: value.NODE_ENV ?? "development",
    clerkSecretKey: value.CLERK_SECRET_KEY,
    clerkWebhookSigningSecret: value.CLERK_WEBHOOK_SIGNING_SECRET,
    clerkGuardianRoleKey: value.CLERK_GUARDIAN_ROLE_KEY,
    clerkAuthorizedParties: splitAuthorizedParties(value.CLERK_AUTHORIZED_PARTIES),
    databaseUrl: value.DATABASE_URL,
    invitationRedirectUrl: value.INVITATION_REDIRECT_URL,
    appLinkParents: value.APP_LINK_PARENTS,
    appLinkDaycare: value.APP_LINK_DAYCARE,
    piiKeyProvider: value.PII_KEY_PROVIDER,
    piiKmsKeyId: value.PII_KMS_KEY_ID ?? null,
    awsRegion: value.AWS_REGION ?? null,
    piiDevWrappingKeyB64: value.PII_DEV_WRAPPING_KEY_B64 ?? null,
  }));
