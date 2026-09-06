import { acknowledgeBriefRequestSchema } from "@handoff/contracts";
import { acknowledgeBrief, createRequestDeps, resolveBriefWorkspace } from "@handoff/server";
import { idempotentJson } from "../../../../http/idempotent-route";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function POST(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "handoffs.acknowledge", idempotent: true },
    async (context) => {
      const briefId = readIdParam(params, "briefId");
      const body = await readJsonBody(request);
      const input = acknowledgeBriefRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      const actorUserId = context.auth.userId;
      const workspaceId = await resolveBriefWorkspace({ deps, actorUserId, briefId });
      // Cursor advance and the optional care start are one transaction with the replay record.
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 200,
        requestBody: body.raw,
        execute: (tx) => acknowledgeBrief({ deps, actorUserId, briefId, input, tx }),
      });
    },
  );
}
