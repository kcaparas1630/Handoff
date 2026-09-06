import { updateChildCaregiversRequestSchema } from "@handoff/contracts";
import {
  createRequestDeps,
  listChildCaregivers,
  resolveChildWorkspace,
  updateChildCaregivers,
} from "@handoff/server";
import { idempotentJson } from "../../../../http/idempotent-route";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "children.caregivers.list" },
    async ({ auth, requestId }) => {
      const childId = readIdParam(params, "childId");
      const deps = createRequestDeps(getRuntime(), requestId);
      const workspaceId = await resolveChildWorkspace({ deps, actorUserId: auth.userId, childId });
      const items = await listChildCaregivers({
        deps,
        actorUserId: auth.userId,
        workspaceId,
        childId,
      });
      return Response.json({ items, nextCursor: null });
    },
  );
}

export function PATCH(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "children.caregivers.update", idempotent: true },
    async (context) => {
      const childId = readIdParam(params, "childId");
      const body = await readJsonBody(request);
      const input = updateChildCaregiversRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      const actorUserId = context.auth.userId;
      const workspaceId = await resolveChildWorkspace({ deps, actorUserId, childId });
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 200,
        requestBody: body.raw,
        execute: async (tx) => ({
          items: await updateChildCaregivers({
            deps,
            actorUserId,
            workspaceId,
            childId,
            input,
            tx,
          }),
          nextCursor: null,
        }),
      });
    },
  );
}
