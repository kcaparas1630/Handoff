import { deleteEventRequestSchema, updateEventRequestSchema } from "@handoff/contracts";
import {
  correctEvent,
  createRequestDeps,
  deleteEvent,
  resolveEventLocation,
} from "@handoff/server";
import { idempotentJson } from "../../../http/idempotent-route";
import { readJsonBody } from "../../../http/request-body";
import { readIdParam } from "../../../lib/route-params";
import { getHandler, getRuntime } from "../../../server-runtime";

export function PATCH(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "events.correct", idempotent: true },
    async (context) => {
      const eventId = readIdParam(params, "eventId");
      const body = await readJsonBody(request);
      const input = updateEventRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      const actorUserId = context.auth.userId;
      const { workspaceId } = await resolveEventLocation({ deps, actorUserId, eventId });
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 200,
        requestBody: body.raw,
        execute: (tx) => correctEvent({ deps, actorUserId, eventId, input, tx }),
      });
    },
  );
}

export function DELETE(request: Request, params: Record<string, string>): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "required", operation: "events.delete", idempotent: true },
    async (context) => {
      const eventId = readIdParam(params, "eventId");
      const body = await readJsonBody(request);
      const input = deleteEventRequestSchema.parse(body.value);
      const deps = createRequestDeps(getRuntime(), context.requestId);
      const actorUserId = context.auth.userId;
      const { workspaceId } = await resolveEventLocation({ deps, actorUserId, eventId });
      // Deletion publishes a revision rather than erasing the row, so it answers with the event.
      return idempotentJson({
        deps,
        context,
        workspaceId,
        actorUserId,
        status: 200,
        requestBody: body.raw,
        execute: (tx) => deleteEvent({ deps, actorUserId, eventId, input, tx }),
      });
    },
  );
}
