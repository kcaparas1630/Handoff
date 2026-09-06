import {
  bigint,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { mediaCleanupState, mediaKind, mediaStatus } from "./enums";
import { handoffSchema } from "./handoff-schema";
import { users } from "./identity";
import { captures } from "./journal";

// One uploaded object belonging to one capture: the recording itself, or a photo or short video
// attached to it. Signed URLs are issued per request and never stored here.
export const mediaAssets = handoffSchema.table(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    childId: uuid("child_id").notNull(),
    captureId: uuid("capture_id").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id),
    kind: mediaKind("kind").notNull(),
    // Provider, bucket, and key together, so the schema is not coupled to one storage vendor.
    storageProvider: text("storage_provider").notNull(),
    bucket: text("bucket").notNull(),
    // Server-generated `workspaceId/childId/captureId/assetId.ext`; clients never supply a path.
    objectKey: text("object_key").notNull(),
    declaredMime: text("declared_mime").notNull(),
    // What the worker actually found in the bytes, which is what viewing decisions use.
    verifiedMime: text("verified_mime"),
    // Charged against the workspace budget before the upload token is issued.
    reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationMs: integer("duration_ms"),
    checksum: text("checksum"),
    status: mediaStatus("status").notNull().default("pending_upload"),
    cleanupState: mediaCleanupState("cleanup_state").notNull().default("none"),
    // When an unfinished upload becomes eligible for object purge and reservation release.
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    // One row per stored object, so a replayed allocation cannot hand out the same key twice.
    uniqueIndex("media_assets_object_key").on(table.storageProvider, table.bucket, table.objectKey),
    // Target of the composite key jobs use to reference an asset without trusting its workspace.
    uniqueIndex("media_assets_workspace_child_id_key").on(
      table.workspaceId,
      table.childId,
      table.id,
    ),
    foreignKey({
      columns: [table.workspaceId, table.childId, table.captureId],
      foreignColumns: [captures.workspaceId, captures.childId, captures.id],
      name: "media_assets_capture_fk",
    }),
    // Drives the expiry sweep for abandoned uploads.
    index("media_assets_status_expires_idx").on(table.status, table.expiresAt),
  ],
);
