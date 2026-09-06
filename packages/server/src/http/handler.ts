// One wrapper for every Expo API route: request id, verified auth, idempotency key, no-store.
import { randomUUID } from "node:crypto";
import { idempotencyKeySchema } from "@handoff/contracts";
import { identityRepository, withIdentityTransaction } from "@handoff/db";
import { ApiHttpError, toErrorResponse } from "./errors";
import type { ServerRuntime } from "../types/runtime";
import type { AuthMode, AuthenticatedUser, HandlerContext, HandlerOptions } from "../types/http";

/** Statuses that must not carry a body when the response is rebuilt. */
const EMPTY_BODY_STATUSES = new Set([204, 205, 304]);

function readBearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") === true ? header.slice("Bearer ".length).trim() : "";
  if (token === "") throw ApiHttpError.unauthorized("A bearer token is required");
  return token;
}

function readIdempotencyKey(request: Request, required: boolean): string | null {
  const header = request.headers.get("idempotency-key");
  if (header === null) {
    if (!required) return null;
    throw ApiHttpError.validationFailed("An Idempotency-Key header is required", {
      "Idempotency-Key": ["Expected a client-generated UUID"],
    });
  }
  const parsed = idempotencyKeySchema.safeParse(header);
  if (!parsed.success) {
    // Free-text keys are rejected: they could carry personal data (data contract §8).
    throw ApiHttpError.validationFailed("The Idempotency-Key header must be a UUID", {
      "Idempotency-Key": ["Expected a client-generated UUID"],
    });
  }
  return parsed.data;
}

export function createHandler({ runtime }: { runtime: ServerRuntime }) {
  async function resolveUser(request: Request): Promise<AuthenticatedUser> {
    const { clerkUserId } = await runtime.clerk.verifySessionToken(readBearerToken(request));
    const user = await withIdentityTransaction(runtime.db, {}, (tx) =>
      identityRepository.findUserByClerkId(tx, clerkUserId),
    );
    // Local users are created only by the bootstrap service, never as a side effect of a request.
    if (user === null || user.status !== "active") {
      throw ApiHttpError.unauthorized("Call /v1/bootstrap first");
    }
    return { clerkUserId, userId: user.id };
  }

  async function resolveAuth<Mode extends AuthMode>(
    request: Request,
    mode: Mode,
  ): Promise<HandlerContext<Mode>["auth"]> {
    if (mode === "required") return (await resolveUser(request)) as HandlerContext<Mode>["auth"];
    if (mode === "bootstrap") {
      const subject = await runtime.clerk.verifySessionToken(readBearerToken(request));
      return { clerkUserId: subject.clerkUserId } as HandlerContext<Mode>["auth"];
    }
    // Webhook routes verify the signed body inside their own service; no bearer token applies.
    return undefined as HandlerContext<Mode>["auth"];
  }

  return {
    async handle<Mode extends AuthMode>(
      request: Request,
      options: HandlerOptions<Mode>,
      run: (context: HandlerContext<Mode>) => Promise<Response>,
    ): Promise<Response> {
      const requestId = randomUUID();
      try {
        const auth = await resolveAuth(request, options.auth);
        const idempotencyKey = readIdempotencyKey(request, options.idempotent === true);
        const response = await run({
          request,
          auth,
          requestId,
          operation: options.operation,
          idempotencyKey,
        });
        const headers = new Headers(response.headers);
        // Every response can carry decrypted personal data, so none of them are cacheable.
        headers.set("Cache-Control", "no-store");
        headers.set("X-Request-Id", requestId);
        // Response headers are immutable, so the JSON payload is copied into a new response.
        const body = EMPTY_BODY_STATUSES.has(response.status) ? undefined : await response.text();
        return new Response(body, { status: response.status, headers });
      } catch (error) {
        return toErrorResponse(error, requestId);
      }
    },
  };
}
