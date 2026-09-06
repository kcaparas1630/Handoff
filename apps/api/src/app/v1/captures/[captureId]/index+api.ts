import { updateCaptureDraftRequestSchema } from "@handoff/contracts";
import {
  createRequestDeps,
  getCapture,
  resolveCaptureWorkspace,
  updateCaptureDraft,
} from "@handoff/server";
import { idempotentJson } from "../../../../http/idempotent-route";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "captures.get" },
    async ({ auth, requestId }) => {
      const captureId = readIdParam(params, "captureId");
      const deps = createRequestDeps(getRuntime(), requestId);
      const dto = await getCapture({ deps, actorUserId: auth.userId, captureId });
      return Response.json(dto);
    },
  );
}

export function PATCH(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "captures.update", idempotent: true },
    async (context) => {
      const captureId = readIdParam(params, "captureId");
      const body = await readJsonBody(request);
      const input = updateCaptureDraftRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      const actorUserId = context.auth.userId;
      const workspaceId = await resolveCaptureWorkspace({ deps, actorUserId, captureId });
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 200,
        requestBody: body.raw,
        execute: (tx) => updateCaptureDraft({ deps, actorUserId, captureId, input, tx }),
      });
    },
  );
}
