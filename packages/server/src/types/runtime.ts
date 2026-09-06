import type { HandoffDatabase } from "@handoff/db";
import type { DataKeyService } from "../security/encryption/data-keys";
import type { ClerkGateway } from "./clerk";
import type { KeyWrapper } from "./encryption";

/** Process-lifetime collaborators built once from validated configuration. */
export interface ServerRuntime {
  db: HandoffDatabase;
  keys: DataKeyService;
  keyWrapper: KeyWrapper;
  clerk: ClerkGateway;
  guardianRoleKey: string;
  invitationRedirectUrl: string;
  now: () => Date;
  close: () => Promise<void>;
}

/** What a service needs for one request. Services receive this explicitly; nothing is global. */
export interface ServiceDeps {
  db: HandoffDatabase;
  keys: DataKeyService;
  keyWrapper: KeyWrapper;
  clerk: ClerkGateway;
  guardianRoleKey: string;
  invitationRedirectUrl: string;
  requestId: string;
  now: () => Date;
}
