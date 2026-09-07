import { updateChildRequestSchema } from "@handoff/contracts";
import {
  createRequestDeps,
  deleteChild,
  getChild,
  resolveChildWorkspace,
  updateChild,
} from "@handoff/server";
import { idempotentJson } from "../../../../http/idempotent-route";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "children.get" },
    async ({ auth, requestId }) => {
      const childId = readIdParam(params, "childId");
      const deps = createRequestDeps(getRuntime(), requestId);
      const workspaceId = await resolveChildWorkspace({ deps, actorUserId: auth.userId, childId });
      const dto = await getChild({ deps, actorUserId: auth.userId, workspaceId, childId });
      return Response.json(dto);
    },
  );
}

export function PATCH(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "children.update", idempotent: true },
    async (context) => {
      const childId = readIdParam(params, "childId");
      const body = await readJsonBody(request);
      const input = updateChildRequestSchema.parse(body.value);
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
        execute: (tx) => updateChild({ deps, actorUserId, workspaceId, childId, input, tx }),
      });
    },
  );
}

export function DELETE(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "children.delete", idempotent: true },
    async ({ auth, requestId }) => {
      const childId = readIdParam(params, "childId");
      // Idempotent by construction, and deliberately outside runIdempotent: this schedules durable
      // work and cancels queue rows on another credential, so a retained response would claim an
      // atomicity that does not exist. Repeating it returns the same 202.
      const result = await deleteChild({
        deps: createRequestDeps(getRuntime(), requestId),
        actorUserId: auth.userId,
        childId,
      });
      // 202: the records are already unreachable, the purge job removes them (data contract §8).
      return Response.json(result, { status: 202 });
    },
  );
}
