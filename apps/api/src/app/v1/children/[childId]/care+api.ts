import { careActionRequestSchema } from "@handoff/contracts";
import {
  createRequestDeps,
  endCare,
  listCare,
  resolveChildWorkspace,
  startCare,
} from "@handoff/server";
import { idempotentJson } from "../../../../http/idempotent-route";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "care.list" },
    async ({ auth, requestId }) => {
      const childId = readIdParam(params, "childId");
      const sessions = await listCare({
        deps: createRequestDeps(getRuntime(), requestId),
        actorUserId: auth.userId,
        childId,
      });
      return Response.json({ sessions });
    },
  );
}

export function POST(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "care.action", idempotent: true },
    async (context) => {
      const childId = readIdParam(params, "childId");
      const body = await readJsonBody(request);
      const input = careActionRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      const actorUserId = context.auth.userId;
      const workspaceId = await resolveChildWorkspace({ deps, actorUserId, childId });
      const act = input.action === "start" ? startCare : endCare;
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 200,
        requestBody: body.raw,
        execute: (tx) => act({ deps, actorUserId, childId, tx }),
      });
    },
  );
}
