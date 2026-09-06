import { completeUploadRequestSchema } from "@handoff/contracts";
import {
  ApiHttpError,
  completeAssetUpload,
  createRequestDeps,
  resolveAssetLocation,
} from "@handoff/server";
import { idempotentJson } from "../../../../http/idempotent-route";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function POST(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "assets.complete", idempotent: true },
    async (context) => {
      const assetId = readIdParam(params, "assetId");
      const body = await readJsonBody(request);
      const input = completeUploadRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      // The stored object decides whether this completion is believed, so a deployment with no
      // storage configured cannot answer at all. Missing configuration, not a caller error.
      if (deps.storage === null) {
        throw ApiHttpError.providerUnavailable("Attachment storage is not available right now");
      }
      const actorUserId = context.auth.userId;
      const { workspaceId } = await resolveAssetLocation({ deps, actorUserId, assetId });
      // The upload state and the validation job commit with the retained response, so a repeated
      // completion neither queues a second `validate_media` nor moves the asset twice.
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 200,
        requestBody: body.raw,
        execute: async (tx) => ({
          asset: await completeAssetUpload({ deps, actorUserId, assetId, input, tx }),
        }),
      });
    },
  );
}
