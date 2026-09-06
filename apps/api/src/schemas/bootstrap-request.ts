import { z } from "zod";

/**
 * `POST /v1/bootstrap` carries at most the display name the client already knows from Clerk.
 * It is not part of packages/contracts because no client hook sends a body today.
 */
export const bootstrapRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
});
