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

/** A blank line in a copied `.env.example` means "not configured", not "configured as empty". */
function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalSetting = (name: string) =>
  z.preprocess(blankToUndefined, z.string().min(1, `${name} must not be empty`).optional());

const optionalUrl = (name: string) =>
  z.preprocess(
    blankToUndefined,
    z.string().refine(isAbsoluteUrl, `${name} must be an absolute URL`).optional(),
  );

const optionalCount = (name: string, max: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: `${name} must be a whole number` })
      .int()
      .min(1)
      .max(max)
      .optional(),
  );

/** An empty or whitespace-only setting is treated as absent rather than as "accept nothing". */
function splitAuthorizedParties(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const parties = value
    .split(",")
    .map((party) => party.trim())
    .filter((party) => party !== "");
  return parties.length === 0 ? null : parties;
}

const DEFAULT_TRANSCRIPTION_MODEL_ID = "nova-3";
const DEFAULT_ANTHROPIC_MODEL_ID = "claude-opus-5";
// Milestone 3 starts at two concurrent jobs with measured timeouts (roadmap logic boundaries).
const DEFAULT_WORKER_CONCURRENCY = 2;
const DEFAULT_WORKER_LEASE_SECONDS = 120;
// Roadmap milestone 5: quotas authorize resource creation before provider work. The defaults are
// per workspace per UTC day unless the name says otherwise, and are deliberately generous enough
// that a pilot caregiver never meets one by accident.
const DEFAULT_METRICS_FLUSH_SECONDS = 60;
const DEFAULT_CAPTURES_PER_USER_PER_DAY = 200;
const DEFAULT_AUDIO_SECONDS_PER_WORKSPACE_PER_DAY = 3600;
const DEFAULT_EXTRACTION_USD_PER_WORKSPACE_PER_DAY = 5;
// How long a deleted workspace's scope keys stay decrypt-only before they may be retired.
const DEFAULT_WORKSPACE_KEY_RETENTION_DAYS = 30;

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
  // Storage, transcription, extraction, and queue settings stay optional so the API can boot for
  // health checks and manual entry without them; the use cases that need them ask explicitly.
  SUPABASE_URL: optionalUrl("SUPABASE_URL"),
  SUPABASE_STORAGE_SECRET_KEY: optionalSetting("SUPABASE_STORAGE_SECRET_KEY"),
  SUPABASE_STORAGE_BUCKET: optionalSetting("SUPABASE_STORAGE_BUCKET"),
  DEEPGRAM_API_KEY: optionalSetting("DEEPGRAM_API_KEY"),
  TRANSCRIPTION_MODEL_ID: optionalSetting("TRANSCRIPTION_MODEL_ID"),
  ANTHROPIC_API_KEY: optionalSetting("ANTHROPIC_API_KEY"),
  ANTHROPIC_MODEL_ID: optionalSetting("ANTHROPIC_MODEL_ID"),
  // The queue credential. Claiming a job is not a capability of the mobile API credential.
  DATABASE_JOB_DISPATCH_URL: optionalSetting("DATABASE_JOB_DISPATCH_URL"),
  WORKER_CONCURRENCY: optionalCount("WORKER_CONCURRENCY", 16),
  WORKER_LEASE_SECONDS: optionalCount("WORKER_LEASE_SECONDS", 3600),
  METRICS_FLUSH_SECONDS: optionalCount("METRICS_FLUSH_SECONDS", 3600),
  // Absent means `GET /v1/internal/metrics` answers 404: the endpoint does not exist until an
  // operator configures a token for it.
  INTERNAL_METRICS_TOKEN: optionalSetting("INTERNAL_METRICS_TOKEN"),
  QUOTA_CAPTURES_PER_USER_PER_DAY: optionalCount("QUOTA_CAPTURES_PER_USER_PER_DAY", 100_000),
  QUOTA_AUDIO_SECONDS_PER_WORKSPACE_PER_DAY: optionalCount(
    "QUOTA_AUDIO_SECONDS_PER_WORKSPACE_PER_DAY",
    1_000_000,
  ),
  QUOTA_EXTRACTION_USD_PER_WORKSPACE_PER_DAY: optionalCount(
    "QUOTA_EXTRACTION_USD_PER_WORKSPACE_PER_DAY",
    10_000,
  ),
  WORKSPACE_KEY_RETENTION_DAYS: optionalCount("WORKSPACE_KEY_RETENTION_DAYS", 3650),
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
    supabaseUrl: value.SUPABASE_URL ?? null,
    supabaseStorageSecretKey: value.SUPABASE_STORAGE_SECRET_KEY ?? null,
    supabaseStorageBucket: value.SUPABASE_STORAGE_BUCKET ?? null,
    deepgramApiKey: value.DEEPGRAM_API_KEY ?? null,
    // Pinned supported model ids; a change is promoted only after the extraction evaluation.
    transcriptionModelId: value.TRANSCRIPTION_MODEL_ID ?? DEFAULT_TRANSCRIPTION_MODEL_ID,
    anthropicApiKey: value.ANTHROPIC_API_KEY ?? null,
    anthropicModelId: value.ANTHROPIC_MODEL_ID ?? DEFAULT_ANTHROPIC_MODEL_ID,
    databaseJobDispatchUrl: value.DATABASE_JOB_DISPATCH_URL ?? null,
    workerConcurrency: value.WORKER_CONCURRENCY ?? DEFAULT_WORKER_CONCURRENCY,
    workerLeaseSeconds: value.WORKER_LEASE_SECONDS ?? DEFAULT_WORKER_LEASE_SECONDS,
    metricsFlushSeconds: value.METRICS_FLUSH_SECONDS ?? DEFAULT_METRICS_FLUSH_SECONDS,
    internalMetricsToken: value.INTERNAL_METRICS_TOKEN ?? null,
    quotaCapturesPerUserPerDay:
      value.QUOTA_CAPTURES_PER_USER_PER_DAY ?? DEFAULT_CAPTURES_PER_USER_PER_DAY,
    quotaAudioSecondsPerWorkspacePerDay:
      value.QUOTA_AUDIO_SECONDS_PER_WORKSPACE_PER_DAY ??
      DEFAULT_AUDIO_SECONDS_PER_WORKSPACE_PER_DAY,
    quotaExtractionUsdPerWorkspacePerDay:
      value.QUOTA_EXTRACTION_USD_PER_WORKSPACE_PER_DAY ??
      DEFAULT_EXTRACTION_USD_PER_WORKSPACE_PER_DAY,
    workspaceKeyRetentionDays:
      value.WORKSPACE_KEY_RETENTION_DAYS ?? DEFAULT_WORKSPACE_KEY_RETENTION_DAYS,
  }));
