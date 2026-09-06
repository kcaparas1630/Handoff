import { createRequestDeps, handleClerkWebhook } from "@handoff/server";
import { getHandler, getRuntime } from "../../../server-runtime";

export function POST(request: Request): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "webhook", operation: "webhooks.clerk" },
    async ({ requestId }) => {
      // The raw request is handed straight to the service: the signature covers the exact body,
      // so nothing here may read, parse, or rebuild it first.
      const { outcome } = await handleClerkWebhook({
        deps: createRequestDeps(getRuntime(), requestId),
        request,
      });
      return Response.json({ outcome });
    },
  );
}
