import { z } from "zod";
import { ApiHttpError } from "@handoff/server";

// Every dynamic segment in the v1 routes is an application UUID.
const identifierSchema = z.uuid();

export function readIdParam(params: Record<string, string>, name: string): string {
  const parsed = identifierSchema.safeParse(params[name]);
  if (parsed.success) return parsed.data;
  // Shape only: the message never repeats the supplied value.
  throw ApiHttpError.validationFailed(`The ${name} path segment is not a valid identifier`, {
    [name]: ["Expected a UUID"],
  });
}
