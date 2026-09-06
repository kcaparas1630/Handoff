import { completeUploadRequestSchema } from "@handoff/contracts";
import { completeUpload, createRequestDeps, resolveCaptureWorkspace } from "@handoff/server";
import { idempotentJson } from "../../../../http/idempotent-route";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function POST(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "captures.complete", idempotent: true },
    async (context) => {
      const captureId = readIdParam(params, "captureId");
      const body = await readJsonBody(request);
      const input = completeUploadRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      const actorUserId = context.auth.userId;
      const workspaceId = await resolveCaptureWorkspace({ deps, actorUserId, captureId });
      // The upload state and the processing job commit with the retained response, so a repeated
      // completion neither queues a second job nor settles the reservation twice.
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 200,
        requestBody: body.raw,
        execute: (tx) => completeUpload({ deps, actorUserId, captureId, input, tx }),
      });
    },
  );
}
