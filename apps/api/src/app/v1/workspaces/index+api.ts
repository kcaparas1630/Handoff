import { createWorkspaceRequestSchema } from "@handoff/contracts";
import { createRequestDeps, initializeWorkspace } from "@handoff/server";
import { readJsonBody } from "../../../http/request-body";
import { getHandler, getRuntime } from "../../../server-runtime";

export function POST(request: Request): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "workspaces.initialize", idempotent: true },
    async ({ auth, requestId }) => {
      const input = createWorkspaceRequestSchema.parse((await readJsonBody(request)).value);
      // Idempotent by construction: initialization finds or creates by clerk_org_id, so a retry
      // returns the same workspace and the same 201 without a replay record.
      const dto = await initializeWorkspace({
        deps: createRequestDeps(getRuntime(), requestId),
        userId: auth.userId,
        clerkUserId: auth.clerkUserId,
        input,
      });
      return Response.json(dto, { status: 201 });
    },
  );
}
