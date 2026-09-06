import { ApiHttpError, createRequestDeps, getAssetReadUrl } from "@handoff/server";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    // No idempotency key: reading changes nothing, and each call reauthorizes and signs afresh.
    { auth: "required", operation: "assets.get" },
    async ({ auth, requestId }) => {
      const assetId = readIdParam(params, "assetId");
      const deps = createRequestDeps(getRuntime(), requestId);
      // Nothing can be signed without storage configuration; that is an unavailable provider
      // rather than a missing attachment, so it must not be reported as the usual 404.
      if (deps.storage === null) {
        throw ApiHttpError.providerUnavailable("Attachment storage is not available right now");
      }
      // The handler already sets `Cache-Control: no-store`, so the short-lived URL in this body
      // is never held by a proxy or a client cache (architecture §6).
      const read = await getAssetReadUrl({ deps, actorUserId: auth.userId, assetId });
      return Response.json(read);
    },
  );
}
