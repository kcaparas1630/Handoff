import { createRequestDeps, deleteWorkspace } from "@handoff/server";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function DELETE(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "workspaces.delete", idempotent: true },
    async ({ auth, requestId }) => {
      const workspaceId = readIdParam(params, "workspaceId");
      // Idempotent by construction, and deliberately outside runIdempotent: this asks Clerk to
      // delete the organization between local writes, so a retained response would claim an
      // atomicity that does not exist (data contract §5).
      const result = await deleteWorkspace({
        deps: createRequestDeps(getRuntime(), requestId),
        actorUserId: auth.userId,
        workspaceId,
      });
      // 202: every member has lost access already, the purge job removes the records.
      return Response.json(result, { status: 202 });
    },
  );
}
