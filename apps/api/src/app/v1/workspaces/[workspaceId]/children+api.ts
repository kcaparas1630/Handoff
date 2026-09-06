import { createChildRequestSchema } from "@handoff/contracts";
import { createChild, createRequestDeps, listChildren } from "@handoff/server";
import { idempotentJson } from "../../../../http/idempotent-route";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "children.list" },
    async ({ auth, requestId }) => {
      const items = await listChildren({
        deps: createRequestDeps(getRuntime(), requestId),
        actorUserId: auth.userId,
        workspaceId: readIdParam(params, "workspaceId"),
      });
      // Milestone 1 returns every authorized child; paging arrives with the event timeline.
      return Response.json({ items, nextCursor: null });
    },
  );
}

export function POST(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "children.create", idempotent: true },
    async (context) => {
      const workspaceId = readIdParam(params, "workspaceId");
      const body = await readJsonBody(request);
      const input = createChildRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId: context.auth.userId,
        status: 201,
        requestBody: body.raw,
        execute: (tx) =>
          createChild({ deps, actorUserId: context.auth.userId, workspaceId, input, tx }),
      });
    },
  );
}
