import { ApiHttpError, createRequestDeps, retryCapture } from "@handoff/server";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function POST(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    // The key is still required by contract, but this route does not run `runIdempotent`: the
    // service is idempotent by construction. It requeues only from `failed` and only through the
    // job's dedupe key, so a repeated retry finds nothing to requeue instead of doubling work.
    { auth: "required", operation: "captures.retry", idempotent: true },
    async ({ auth, requestId }) => {
      const captureId = readIdParam(params, "captureId");
      const deps = createRequestDeps(getRuntime(), requestId);
      // Requeueing runs on the dispatcher credential, which a deployment without
      // DATABASE_JOB_DISPATCH_URL does not have. That is missing configuration, not a caller
      // error, so it is reported as an unavailable provider the client may retry later.
      if (deps.jobsDb === null) {
        throw ApiHttpError.providerUnavailable("Processing is not available right now");
      }
      const capture = await retryCapture({ deps, actorUserId: auth.userId, captureId });
      return Response.json({ capture });
    },
  );
}
