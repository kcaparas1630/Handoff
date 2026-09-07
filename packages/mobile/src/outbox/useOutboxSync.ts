import { useApiClient, useApiUserId } from "@handoff/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { recordClientMetric } from "../observability/metrics";
import { useRecordingStore } from "../state/recording-store";
import { listPendingForUser, openOutbox } from "./database";
import { syncOutbox } from "./sync";

/**
 * How often a pending recording is retried while the app is open. `@react-native-community/netinfo`
 * is not a dependency of this project, so there is no reconnect event to listen for: foregrounding
 * plus this interval are what recover an upload after the connection comes back.
 */
const retryIntervalMs = 30_000;

/**
 * Drains the upload outbox on mount, on foreground, when a screen asks for it, and on a timer
 * while rows remain. Mounted once by MobileProviders.
 */
export function useOutboxSync(): { pendingCount: number } {
  const client = useApiClient();
  const clerkUserId = useApiUserId();
  const syncRequestedAt = useRecordingStore((state) => state.syncRequestedAt);
  const [pendingCount, setPendingCount] = useState(0);
  const isRunning = useRef(false);

  const drain = useCallback(async (): Promise<void> => {
    if (clerkUserId === null || isRunning.current) return;
    isRunning.current = true;
    try {
      const db = await openOutbox();
      await syncOutbox({ db, client, clerkUserId });
      setPendingCount((await listPendingForUser(db, clerkUserId)).length);
    } catch {
      // A failed pass is already recorded on each row; the next trigger tries again.
    } finally {
      isRunning.current = false;
    }
  }, [client, clerkUserId]);

  useEffect(() => {
    if (clerkUserId === null) {
      setPendingCount(0);
      return;
    }
    void drain();
  }, [clerkUserId, drain, syncRequestedAt]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      recordClientMetric("app_foreground");
      void drain();
    });
    return () => subscription.remove();
  }, [drain]);

  useEffect(() => {
    if (pendingCount === 0) return;
    const timer = setInterval(() => void drain(), retryIntervalMs);
    return () => clearInterval(timer);
  }, [drain, pendingCount]);

  return { pendingCount };
}
