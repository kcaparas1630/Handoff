import { bootstrap, createRequestDeps } from "@handoff/server";
import { readJsonBody } from "../../http/request-body";
import { bootstrapRequestSchema } from "../../schemas/bootstrap-request";
import { getHandler, getRuntime } from "../../server-runtime";

export function POST(request: Request): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "bootstrap", operation: "identity.bootstrap", idempotent: true },
    async ({ auth, requestId }) => {
      const input = bootstrapRequestSchema.parse((await readJsonBody(request)).value);
      // Idempotent by construction: bootstrap upserts the local user by verified Clerk subject
      // and reconciles memberships, so no replay record is retained.
      const dto = await bootstrap({
        deps: createRequestDeps(getRuntime(), requestId),
        clerkUserId: auth.clerkUserId,
        displayName: input.displayName ?? null,
      });
      return Response.json(dto);
    },
  );
}
