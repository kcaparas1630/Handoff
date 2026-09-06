import type { ChildPermission } from "@handoff/contracts";

export type CareStatusProps = {
  childId: string;
  /** Comes from the child DTO. This component performs no authorization of its own. */
  permission: ChildPermission;
};
