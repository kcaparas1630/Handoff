import { ClerkLoaded, ClerkLoading, ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { ApiClientProvider, createApiClient } from "@handoff/api-client";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";

import { secureTokenCache } from "./auth/token-cache";
import { useSelectedContext } from "./state/context-store";
import type { MobileProvidersProps } from "./types/providers";

const flavorNames = { parents: "Handoff Parents", daycare: "Handoff Daycare" } as const;

export function MobileProviders({
  children,
  flavor,
  publishableKey,
  apiUrl,
}: MobileProvidersProps) {
  const [queryClient] = useState(createQueryClient);

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={secureTokenCache}>
      <ClerkLoading>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator accessibilityLabel={`Starting ${flavorNames[flavor]}`} />
        </View>
      </ClerkLoading>
      <ClerkLoaded>
        <QueryClientProvider client={queryClient}>
          <AuthenticatedApiClient apiUrl={apiUrl}>{children}</AuthenticatedApiClient>
        </QueryClientProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 10_000, retry: 1 },
      // The API client mints a fresh Idempotency-Key per attempt, so an automatic mutation retry
      // could create a second record. Retries are the caller's explicit action.
      mutations: { retry: 0 },
    },
  });
}

function AuthenticatedApiClient({ apiUrl, children }: { apiUrl: string; children: ReactNode }) {
  const { getToken, userId, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  // Clerk replaces getToken as the session changes; the ref keeps one stable client identity.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const client = useMemo(
    () => createApiClient({ baseUrl: apiUrl, getToken: () => getTokenRef.current() }),
    [apiUrl],
  );

  useEffect(() => {
    if (isSignedIn) return;
    // architecture.md section 7: sign-out drops every cached server record and selection.
    queryClient.clear();
    useSelectedContext.getState().resetSelection();
  }, [isSignedIn, queryClient]);

  return (
    <ApiClientProvider client={client} userId={userId ?? null}>
      {children}
    </ApiClientProvider>
  );
}
