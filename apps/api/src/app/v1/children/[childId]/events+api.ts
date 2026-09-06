import { eventsListQuerySchema } from "@handoff/contracts";
import { createRequestDeps, listEvents } from "@handoff/server";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "events.list" },
    async ({ auth, requestId }) => {
      const childId = readIdParam(params, "childId");
      const search = new URL(request.url).searchParams;
      const query = eventsListQuerySchema.parse(Object.fromEntries(search));
      const page = await listEvents({
        deps: createRequestDeps(getRuntime(), requestId),
        actorUserId: auth.userId,
        childId,
        query,
      });
      return Response.json(page);
    },
  );
}
