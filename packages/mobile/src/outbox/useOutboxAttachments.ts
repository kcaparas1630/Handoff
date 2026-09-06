import { useApiUserId } from "@handoff/api-client";
import { useCallback, useEffect, useState } from "react";

import { useRecordingStore } from "../state/recording-store";
import { listAttachmentsForUser } from "./attachment-database";
import { openOutbox } from "./database";
import { summariseAttachments } from "./lib/attachment-summary";
import type { OutboxAttachment, OutboxAttachmentSummary } from "./types/attachment";

const pollMs = 3_000;

export type UseOutboxAttachments = {
  /** This account's queued attachments for the requested scope, oldest first. */
  rows: readonly OutboxAttachment[];
  summary: OutboxAttachmentSummary;
  /** Re-reads the table immediately, for example straight after enqueuing a file. */
  refresh: () => void;
};

/**
 * The attachments this account still holds for one capture, or for every capture when `captureId`
 * is null. Screens read it to say honestly which files are only on this phone.
 */
export function useOutboxAttachments(captureId: string | null = null): UseOutboxAttachments {
  const clerkUserId = useApiUserId();
  const syncRequestedAt = useRecordingStore((state) => state.syncRequestedAt);
  const [rows, setRows] = useState<readonly OutboxAttachment[]>([]);
  const [readAt, setReadAt] = useState(0);

  const refresh = useCallback(() => setReadAt(Date.now()), []);

  useEffect(() => {
    if (clerkUserId === null) {
      setRows([]);
      return;
    }
    let isMounted = true;

    const read = (): void => {
      void openOutbox()
        .then((db) => listAttachmentsForUser(db, clerkUserId))
        .then((all) => {
          if (!isMounted) return;
          setRows(captureId === null ? all : all.filter((row) => row.captureId === captureId));
        });
    };
    read();
    const timer = setInterval(read, pollMs);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [captureId, clerkUserId, readAt, syncRequestedAt]);

  return { rows, summary: summariseAttachments(rows), refresh };
}
