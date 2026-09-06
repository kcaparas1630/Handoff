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
