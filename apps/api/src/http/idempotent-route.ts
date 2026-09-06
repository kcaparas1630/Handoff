// Shared replay guard for workspace-scoped writes that touch nothing but the database. The
// service joins this transaction, so the write and its retained response commit together
// (data contract §5). Routes that call Clerk between local writes must not use this.
import { withTenantTransaction } from "@handoff/db";
import { ApiHttpError, runIdempotent } from "@handoff/server";
import type { HandlerContext, ScopedTransaction, ServiceDeps } from "@handoff/server";

export async function idempotentJson({
  deps,
  context,
  workspaceId,
  actorUserId,
  status,
  requestBody = "",
  execute,
}: {
  deps: ServiceDeps;
  context: HandlerContext<"required">;
  workspaceId: string;
  actorUserId: string;
  /** Recorded with the retained response and replayed when the same request is repeated. */
  status: number;
  requestBody?: string;
  execute: (tx: ScopedTransaction) => Promise<unknown>;
}): Promise<Response> {
  const key = context.idempotencyKey;
  // The handler already required the header; this narrows the type for the retained record.
  if (key === null) throw ApiHttpError.validationFailed("An Idempotency-Key header is required");

  const result = await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
    runIdempotent({
      tx,
      keys: deps.keys,
      actor: { userId: actorUserId },
      operation: context.operation,
      key,
      scope: { kind: "workspace", workspaceId },
      requestBody,
      now: deps.now,
      execute: async (scoped) => ({
        status,
        body: await execute({ transaction: scoped, workspaceId }),
      }),
    }),
  );
  return Response.json(result.body, { status: result.status });
}
