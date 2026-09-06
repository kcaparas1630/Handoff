import { createBrief, createRequestDeps, resolveChildWorkspace } from "@handoff/server";
import { idempotentJson } from "../../../../http/idempotent-route";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function POST(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "handoffs.create", idempotent: true },
    async (context) => {
      const childId = readIdParam(params, "childId");
      const body = await readJsonBody(request);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      const actorUserId = context.auth.userId;
      const workspaceId = await resolveChildWorkspace({ deps, actorUserId, childId });
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 201,
        requestBody: body.raw,
        // Selection owns a repeatable-read transaction of its own, so the outer replay
        // transaction records the response but never lends the service its connection.
        execute: () => createBrief({ deps, actorUserId, childId }),
      });
    },
  );
}
