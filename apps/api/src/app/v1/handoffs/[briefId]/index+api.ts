import { createRequestDeps, getBrief } from "@handoff/server";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "handoffs.get" },
    async ({ auth, requestId }) => {
      const briefId = readIdParam(params, "briefId");
      // A brief belongs to one recipient; anyone else gets the same 404 as an unknown id.
      const dto = await getBrief({
        deps: createRequestDeps(getRuntime(), requestId),
        actorUserId: auth.userId,
        briefId,
      });
      return Response.json(dto);
    },
  );
}
