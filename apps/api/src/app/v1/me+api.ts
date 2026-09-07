import { updateSelfRequestSchema } from "@handoff/contracts";
import { createRequestDeps, updateSelf } from "@handoff/server";
import { readJsonBody } from "../../http/request-body";
import { getHandler, getRuntime } from "../../server-runtime";

export function PATCH(request: Request): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "me.update", idempotent: true },
    async ({ auth, requestId }) => {
      const body = await readJsonBody(request);
      const input = updateSelfRequestSchema.parse(body.value);
      // Naturally idempotent: recording the accepted notice version twice records the same
      // version, so there is no retained response to replay.
      const dto = await updateSelf({
        deps: createRequestDeps(getRuntime(), requestId),
        actorUserId: auth.userId,
        input,
      });
      return Response.json(dto);
    },
  );
}
