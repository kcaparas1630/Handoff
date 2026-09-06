import { ApiHttpError } from "@handoff/server";

export interface JsonBody {
  /** Exact bytes received; the idempotency fingerprint is computed over them. */
  raw: string;
  value: unknown;
}

/** Reads a JSON body once. An empty body is an empty object so optional-field schemas still pass. */
export async function readJsonBody(request: Request): Promise<JsonBody> {
  const raw = await request.text();
  if (raw.trim() === "") return { raw: "", value: {} };
  try {
    return { raw, value: JSON.parse(raw) as unknown };
  } catch {
    throw ApiHttpError.validationFailed("The request body is not valid JSON");
  }
}
