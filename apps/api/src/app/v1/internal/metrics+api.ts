import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { ApiHttpError } from "@handoff/server";
import { getHandler, getRuntime, getServerEnv } from "../../../server-runtime";

/**
 * Operator endpoint, not part of the mobile contract. It is protected by a shared token rather
 * than a Clerk session because a probe has no user, and it answers 404 rather than 401 when no
 * token is configured: an endpoint nobody enabled should not announce that it exists.
 */
function assertInternalToken(request: Request): void {
  const configured = getServerEnv().internalMetricsToken;
  if (configured === null) throw ApiHttpError.notFound();
  const supplied = request.headers.get("x-internal-token") ?? "";
  const expected = Buffer.from(configured, "utf8");
  const offered = Buffer.from(supplied, "utf8");
  // Compare a fixed-length digest-shaped pair: unequal lengths would leak through an early return.
  const matches = expected.length === offered.length && timingSafeEqual(expected, offered);
  if (!matches) throw ApiHttpError.notFound();
}

export function GET(request: Request): Promise<Response> {
  return getHandler().handle(request, { auth: "none", operation: "internal.metrics" }, () => {
    assertInternalToken(request);
    // Counters, durations, and opaque label values only; the snapshot carries no journal content.
    return Promise.resolve(Response.json(getRuntime().metrics.snapshot()));
  });
}
