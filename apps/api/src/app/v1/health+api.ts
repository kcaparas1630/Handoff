import { randomUUID } from "node:crypto";

// Readiness only: no configuration, no database, and no secrets, so a probe can run before the
// server runtime has ever been built.
export function GET(): Response {
  return Response.json(
    { status: "ok", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store", "X-Request-Id": randomUUID() } },
  );
}
