// Startup validation. Never include a configuration value in an error, a log, or a response.
import { serverEnvSchema } from "../schemas/server-env";
import type { ServerEnv } from "../types/server-env";

export class ServerEnvError extends Error {
  readonly variables: string[];

  constructor(variables: string[], details: string[]) {
    super(`Invalid server configuration: ${details.join("; ")}`);
    this.name = "ServerEnvError";
    this.variables = variables;
  }
}

export function loadServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  const variables = new Set<string>();
  const details: string[] = [];
  for (const issue of parsed.error.issues) {
    const variable = issue.path[0];
    if (typeof variable === "string") variables.add(variable);
    details.push(issue.message);
  }
  throw new ServerEnvError([...variables], details);
}

export interface StorageEnv {
  url: string;
  secretKey: string;
  bucket: string;
}

/**
 * The API needs storage configuration before it can sign an upload. Missing settings are named,
 * never their values, so a startup failure can be read from a log safely.
 */
export function requireStorageEnv(env: ServerEnv): StorageEnv {
  const { supabaseUrl, supabaseStorageSecretKey, supabaseStorageBucket } = env;
  const missing: string[] = [];
  if (supabaseUrl === null) missing.push("SUPABASE_URL");
  if (supabaseStorageSecretKey === null) missing.push("SUPABASE_STORAGE_SECRET_KEY");
  if (supabaseStorageBucket === null) missing.push("SUPABASE_STORAGE_BUCKET");
  if (supabaseUrl === null || supabaseStorageSecretKey === null || supabaseStorageBucket === null) {
    throw new ServerEnvError(missing, [`${missing.join(", ")} must be set to store recordings`]);
  }
  return { url: supabaseUrl, secretKey: supabaseStorageSecretKey, bucket: supabaseStorageBucket };
}

export interface WorkerEnv extends StorageEnv {
  jobDispatchUrl: string;
  deepgramApiKey: string;
  anthropicApiKey: string;
}

/** The worker additionally needs the queue credential and both providers. */
export function requireWorkerEnv(env: ServerEnv): WorkerEnv {
  const storage = requireStorageEnv(env);
  const { databaseJobDispatchUrl, deepgramApiKey, anthropicApiKey } = env;
  const missing: string[] = [];
  if (databaseJobDispatchUrl === null) missing.push("DATABASE_JOB_DISPATCH_URL");
  if (deepgramApiKey === null) missing.push("DEEPGRAM_API_KEY");
  if (anthropicApiKey === null) missing.push("ANTHROPIC_API_KEY");
  if (databaseJobDispatchUrl === null || deepgramApiKey === null || anthropicApiKey === null) {
    throw new ServerEnvError(missing, [`${missing.join(", ")} must be set to run the worker`]);
  }
  return { ...storage, jobDispatchUrl: databaseJobDispatchUrl, deepgramApiKey, anthropicApiKey };
}
