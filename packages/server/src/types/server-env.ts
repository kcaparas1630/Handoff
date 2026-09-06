import type { z } from "zod";
import type { serverEnvSchema } from "../schemas/server-env";

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type PiiKeyProvider = ServerEnv["piiKeyProvider"];
