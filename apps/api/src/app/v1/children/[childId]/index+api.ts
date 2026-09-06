import { updateChildRequestSchema } from "@handoff/contracts";
import {
  ApiHttpError,
  createRequestDeps,
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

export function DELETE(request: Request): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "children.delete" },
    // The contract reserves this endpoint. Deleting the profile alone would leave stored objects
    // and copied snapshots behind, so nothing is deleted until the milestone 5 purge job exists.
    () =>
      Promise.reject(
        new ApiHttpError({
          status: 501,
          code: "internal",
          message: "Child deletion arrives with the purge job in milestone 5",
        }),
      ),
  );
}
