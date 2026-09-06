import { createInvitationRequestSchema } from "@handoff/contracts";
import { createInvitation, createRequestDeps, listInvitations } from "@handoff/server";
import { readJsonBody } from "../../../../http/request-body";
import { readIdParam } from "../../../../lib/route-params";
import { getHandler, getRuntime } from "../../../../server-runtime";

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "invitations.list" },
    async ({ auth, requestId }) => {
      const items = await listInvitations({
        deps: createRequestDeps(getRuntime(), requestId),
        actorUserId: auth.userId,
        workspaceId: readIdParam(params, "workspaceId"),
      });
      return Response.json({ items, nextCursor: null });
    },
  );
}

export function POST(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "invitations.create", idempotent: true },
    async ({ auth, requestId }) => {
      const workspaceId = readIdParam(params, "workspaceId");
      const input = createInvitationRequestSchema.parse((await readJsonBody(request)).value);
      // Idempotent by construction, and deliberately outside runIdempotent: Clerk is called
      // between local writes (data contract §5). A repeated address returns the open intent.
      const dto = await createInvitation({
        deps: createRequestDeps(getRuntime(), requestId),
        actorUserId: auth.userId,
        workspaceId,
        input,
      });
      return Response.json(dto, { status: 201 });
    },
  );
}
