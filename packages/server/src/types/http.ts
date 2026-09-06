import type { IdempotencyKey } from "@handoff/contracts";

/**
 * `required` resolves the local user; `bootstrap` verifies the token only, because
 * `POST /v1/bootstrap` is the one route allowed to create that local user.
 */
export type AuthMode = "required" | "bootstrap" | "webhook" | "none";

export interface AuthenticatedUser {
  clerkUserId: string;
  userId: string;
}

export type HandlerAuth<Mode extends AuthMode> = Mode extends "required"
  ? AuthenticatedUser
  : Mode extends "bootstrap"
    ? { clerkUserId: string }
    : undefined;

export interface HandlerOptions<Mode extends AuthMode> {
  auth: Mode;
  /** Audit and log label, such as `workspaces.create`. */
  operation: string;
  /** Requires and validates an `Idempotency-Key` header. */
  idempotent?: boolean;
}

export interface HandlerContext<Mode extends AuthMode> {
  request: Request;
  auth: HandlerAuth<Mode>;
  requestId: string;
  /** The declared operation name, reused as the idempotency scope key. */
  operation: string;
  idempotencyKey: IdempotencyKey | null;
}
