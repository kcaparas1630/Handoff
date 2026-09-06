import { createAssetUploadRequestSchema } from "@handoff/contracts";
import {
  ApiHttpError,
  createAssetUpload,
  createRequestDeps,
  resolveCaptureWorkspace,
} from "@handoff/server";
import { idempotentJson } from "../../../../http/idempotent-route";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function POST(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "assets.create", idempotent: true },
    async (context) => {
      const captureId = readIdParam(params, "captureId");
      const body = await readJsonBody(request);
      const input = createAssetUploadRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      // A deployment without storage configuration cannot allocate an object at all. That is
      // missing configuration rather than a caller error, so it is an unavailable provider.
      if (deps.storage === null) {
        throw ApiHttpError.providerUnavailable("Attachment storage is not available right now");
      }
      const actorUserId = context.auth.userId;
      const workspaceId = await resolveCaptureWorkspace({ deps, actorUserId, captureId });
      // The quota reservation, the asset row, and the cleanup job commit with the retained
      // response, so a repeated request neither spends the budget twice nor allocates a second
      // object. The outbox replays this call under the same key to recover a dropped connection,
      // which is why the authorization it returns is part of that retained response.
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 201,
        requestBody: body.raw,
        execute: (tx) => createAssetUpload({ deps, actorUserId, captureId, input, tx }),
      });
    },
  );
}
