import { createRequestDeps, revokeMember } from "@handoff/server";
import { readIdParam } from "../../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../../server-runtime";

export function DELETE(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "memberships.revoke", idempotent: true },
    async ({ auth, requestId }) => {
      const workspaceId = readIdParam(params, "workspaceId");
      const targetUserId = readIdParam(params, "userId");
      // Idempotent by construction, and deliberately outside runIdempotent: this schedules a Clerk
      // removal between local writes, so a retained response would claim an atomicity that does not
      // exist (data contract §5). Repeating it on an already-revoked member returns 404.
      const result = await revokeMember({
        deps: createRequestDeps(getRuntime(), requestId),
        actorUserId: auth.userId,
        workspaceId,
        targetUserId,
      });
      return Response.json(result);
    },
  );
}
