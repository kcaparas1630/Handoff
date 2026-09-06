import {
  createRequestDeps,
  getInvitation,
  resolveInvitationWorkspace,
  revokeInvitation,
} from "@handoff/server";
import { readIdParam } from "../../../lib/route-params";
import { getHandler, getRuntime } from "../../../server-runtime";

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "invitations.get" },
    async ({ auth, requestId }) => {
      const invitationId = readIdParam(params, "invitationId");
      const deps = createRequestDeps(getRuntime(), requestId);
      const actorUserId = auth.userId;
      const workspaceId = await resolveInvitationWorkspace({ deps, actorUserId, invitationId });
      const dto = await getInvitation({ deps, actorUserId, workspaceId, invitationId });
      return Response.json(dto);
    },
  );
}

export function DELETE(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "invitations.revoke", idempotent: true },
    async ({ auth, requestId }) => {
      const invitationId = readIdParam(params, "invitationId");
      const deps = createRequestDeps(getRuntime(), requestId);
      const actorUserId = auth.userId;
      const workspaceId = await resolveInvitationWorkspace({ deps, actorUserId, invitationId });
      // Idempotent by construction, and deliberately outside runIdempotent: Clerk is called
      // between local writes (data contract §5). Revoking twice returns the same revoked intent.
      const dto = await revokeInvitation({ deps, actorUserId, workspaceId, invitationId });
      return Response.json(dto);
    },
  );
}
