import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import type { ApiClient } from "./types/api-client";

type ApiClientContextValue = {
  client: ApiClient;
  /** Signed-in user id used to scope every query key; null while signed out. */
  userId: string | null;
};

const ApiClientContext = createContext<ApiClientContextValue | null>(null);

export type ApiClientProviderProps = {
  client: ApiClient;
  userId: string | null;
  children: ReactNode;
};

export function ApiClientProvider({ client, userId, children }: ApiClientProviderProps) {
  const value = useMemo(() => ({ client, userId }), [client, userId]);
  return <ApiClientContext.Provider value={value}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const value = useContext(ApiClientContext);
  if (value === null) throw new Error("useApiClient requires an ApiClientProvider ancestor.");
  return value.client;
}

export function useApiUserId(): string | null {
  const value = useContext(ApiClientContext);
  if (value === null) throw new Error("useApiUserId requires an ApiClientProvider ancestor.");
  return value.userId;
}
