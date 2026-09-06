import { confirmCaptureRequestSchema } from "@handoff/contracts";
import { confirmCapture, createRequestDeps, resolveCaptureWorkspace } from "@handoff/server";
import { idempotentJson } from "../../../../http/idempotent-route";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function POST(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "captures.confirm", idempotent: true },
    async (context) => {
      const captureId = readIdParam(params, "captureId");
      const body = await readJsonBody(request);
      const input = confirmCaptureRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      const actorUserId = context.auth.userId;
      const workspaceId = await resolveCaptureWorkspace({ deps, actorUserId, captureId });
      // A confirmation that arrives without the original key still replays: the service returns
      // the events an already-confirmed capture created rather than publishing a second set.
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 200,
        requestBody: body.raw,
        execute: (tx) => confirmCapture({ deps, actorUserId, captureId, input, tx }),
      });
    },
  );
}
