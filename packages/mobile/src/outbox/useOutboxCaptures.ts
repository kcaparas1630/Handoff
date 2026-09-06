import { useApiUserId } from "@handoff/api-client";
import { useCallback, useEffect, useState } from "react";

import { useRecordingStore } from "../state/recording-store";
import { findOutboxCapture, listAllForUser, openOutbox } from "./database";
import type { OutboxCapture } from "./types/outbox";

const waitingForCaptureMs = 1_000;
const settledPollMs = 5_000;

/**
 * Watches one local row until the server has allocated its capture. Reading the outbox is how the
 * review screen turns `local:<id>` into a capture id without guessing one.
 */
export function useOutboxCapture(localId: string | null): {
  row: OutboxCapture | null;
  isLoading: boolean;
} {
  const [row, setRow] = useState<OutboxCapture | null>(null);
  const [isLoading, setIsLoading] = useState(localId !== null);

  const read = useCallback(async (): Promise<OutboxCapture | null> => {
    if (localId === null) return null;
    const db = await openOutbox();
    return findOutboxCapture(db, localId);
  }, [localId]);

  useEffect(() => {
    if (localId === null) {
      setRow(null);
      setIsLoading(false);
      return;
    }
    let isMounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = (): void => {
      void read().then((next) => {
        if (!isMounted) return;
        setRow(next);
        setIsLoading(false);
        // Once the capture id exists the server is authoritative; slow down to a background check.
        const delay = next?.captureId === null ? waitingForCaptureMs : settledPollMs;
        timer = setTimeout(poll, delay);
      });
    };
    poll();

    return () => {
      isMounted = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [localId, read]);

  return { row, isLoading };
}

/**
 * This account's recordings that have not been reviewed yet, optionally narrowed to one child.
 * The dashboard uses it to offer a way back into a recording that is still on its way.
 */
export function useOutboxCaptures(childId: string | null = null): OutboxCapture[] {
  const clerkUserId = useApiUserId();
  const syncRequestedAt = useRecordingStore((state) => state.syncRequestedAt);
  const [rows, setRows] = useState<OutboxCapture[]>([]);

  useEffect(() => {
    if (clerkUserId === null) {
      setRows([]);
      return;
    }
    let isMounted = true;

    const read = (): void => {
      void openOutbox()
        .then((db) => listAllForUser(db, clerkUserId))
        .then((all) => {
          if (!isMounted) return;
          setRows(childId === null ? all : all.filter((row) => row.childId === childId));
        });
    };
    read();
    const timer = setInterval(read, settledPollMs);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [childId, clerkUserId, syncRequestedAt]);

  return rows;
}
