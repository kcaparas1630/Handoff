import { createCaptureRequestSchema } from "@handoff/contracts";
import { createCapture, createRequestDeps, resolveChildWorkspace } from "@handoff/server";
import { idempotentJson } from "../../../http/idempotent-route";
import { readJsonBody } from "../../../http/request-body";
import { getHandler, getRuntime } from "../../../server-runtime";

export function POST(request: Request): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "captures.create", idempotent: true },
    async (context) => {
      const body = await readJsonBody(request);
      const input = createCaptureRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      const actorUserId = context.auth.userId;
      // The service resolves the same workspace from the selected child; resolving it here first
      // lets the capture and its retained response commit in one transaction.
      const workspaceId = await resolveChildWorkspace({
        deps,
        actorUserId,
        childId: input.childId,
      });
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 201,
        requestBody: body.raw,
        execute: (tx) => createCapture({ deps, actorUserId, input, tx }),
      });
    },
  );
}
