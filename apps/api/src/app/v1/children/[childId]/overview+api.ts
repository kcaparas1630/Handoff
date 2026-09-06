import { createRequestDeps, getOverview } from "@handoff/server";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "overview.get" },
    async ({ auth, requestId }) => {
      const childId = readIdParam(params, "childId");
      // Reading the dashboard never advances the caller's handoff cursor (data contract §8).
      const dto = await getOverview({
        deps: createRequestDeps(getRuntime(), requestId),
        actorUserId: auth.userId,
        childId,
      });
      return Response.json(dto);
    },
  );
}
