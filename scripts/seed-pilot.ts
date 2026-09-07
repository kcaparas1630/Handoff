// Seeds a synthetic pilot environment against a development database. Server-side only: it imports
// @handoff/db and @handoff/server and runs the real services, so every row it creates is encrypted,
// authorized, and journalled exactly as the app would create it.
//
//   pnpm seed:pilot -- --owner user_… --staff user_… --guardian user_… \
//     --daycare-org org_… --household-org org_… --household-org org_…
//
// Clerk owns identity and organization membership (docs/architecture.md section 1), so this script
// does not invent memberships. Create the three organizations in a Clerk development instance
// first, make --owner an administrator of each, and add --staff and --guardian to the daycare
// organization. The script then reconciles what Clerk reports and refuses to continue if a
// requested account is not actually a member.
//
// It prints ids only: no child name, no email, no transcript, no connection string.
import { randomUUID } from "node:crypto";
import type {
  ChildCaregiverGrant,
  ConfirmedCandidate,
  CreateCaptureRequest,
} from "../packages/contracts/src/index";
import {
  bootstrap,
  confirmCapture,
  createCapture,
  createChild,
  createRequestDeps,
  createServerRuntime,
  initializeWorkspace,
  loadServerEnv,
  ServerEnvError,
  updateChildCaregivers,
} from "../packages/server/src/index";
import type { ServiceDeps } from "../packages/server/src/types/runtime";
import { occurrenceFor, syntheticDay } from "./lib/pilot-fixtures";

const PILOT_TIMEZONE = "America/Vancouver";
const PILOT_DAYS = 7;
const DAYCARE_CHILD_LABELS = ["A", "B", "C", "D"];
const HOUSEHOLD_CHILD_LABELS = ["E", "F"];

interface Options {
  ownerClerkUserId: string;
  staffClerkUserId: string;
  guardianClerkUserId: string;
  daycareOrgId: string;
  householdOrgIds: string[];
}

function parseOptions(argv: readonly string[]): Options {
  const single = new Map<string, string>();
  const householdOrgIds: string[] = [];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !flag.startsWith("--")) {
      throw new Error(`expected --flag value pairs, found "${String(flag)}"`);
    }
    if (flag === "--household-org") householdOrgIds.push(value);
    else single.set(flag, value);
  }

  const require_ = (flag: string, prefix: string): string => {
    const value = single.get(flag);
    if (value === undefined) throw new Error(`${flag} is required`);
    if (!value.startsWith(prefix)) throw new Error(`${flag} must be a Clerk ${prefix}… id`);
    return value;
  };

  if (householdOrgIds.length !== 2) {
    throw new Error("exactly two --household-org values are required");
  }
  for (const orgId of householdOrgIds) {
    if (!orgId.startsWith("org_")) throw new Error("--household-org must be a Clerk org_… id");
  }

  return {
    ownerClerkUserId: require_("--owner", "user_"),
    staffClerkUserId: require_("--staff", "user_"),
    guardianClerkUserId: require_("--guardian", "user_"),
    daycareOrgId: require_("--daycare-org", "org_"),
    householdOrgIds,
  };
}

/** Reconciles one Clerk account and returns its local id plus the workspaces it actually joined. */
async function signIn(
  deps: ServiceDeps,
  clerkUserId: string,
  displayName: string,
): Promise<{ userId: string; workspaceIds: Set<string> }> {
  const response = await bootstrap({ deps, clerkUserId, displayName });
  return {
    userId: response.user.id,
    workspaceIds: new Set(response.workspaces.map((workspace) => workspace.id)),
  };
}

async function seedWeekOfCare({
  deps,
  authorUserId,
  childId,
  childIndex,
  today,
}: {
  deps: ServiceDeps;
  authorUserId: string;
  childId: string;
  childIndex: number;
  today: Date;
}): Promise<number> {
  let confirmedCount = 0;

  for (let dayIndex = 0; dayIndex < PILOT_DAYS; dayIndex += 1) {
    const dayStart = new Date(today);
    dayStart.setUTCDate(dayStart.getUTCDate() - (PILOT_DAYS - 1 - dayIndex));
    dayStart.setUTCHours(0, 0, 0, 0);

    const candidates: ConfirmedCandidate[] = syntheticDay(childIndex, dayIndex).map((entry) => {
      const { occurredAt, endedAt } = occurrenceFor(entry, dayStart);
      return {
        id: randomUUID(),
        kind: entry.kind,
        occurredAt,
        endedAt,
        timePrecision: entry.timePrecision,
        amountValue: entry.amountValue,
        amountUnit: entry.amountUnit,
        details: entry.details,
        important: entry.important,
        sourceQuote: null,
        ambiguities: [],
        discarded: false,
      };
    });

    // Manual input: no audio object and no provider call, so seeding costs nothing and needs
    // neither storage nor the worker. Confirmation is the same publication path the app uses.
    const request: CreateCaptureRequest = {
      childId,
      clientCaptureId: randomUUID(),
      inputKind: "manual",
      capturedAt: new Date(dayStart.getTime() + 18 * 3_600_000).toISOString(),
      timezone: PILOT_TIMEZONE,
      locale: "en-CA",
      candidates: candidates.map((candidate) => ({
        ...candidate,
        sourceStart: null,
        sourceEnd: null,
      })),
    };
    const capture = await createCapture({ deps, actorUserId: authorUserId, input: request });
    const confirmed = await confirmCapture({
      deps,
      actorUserId: authorUserId,
      captureId: capture.id,
      input: { expectedDraftVersion: capture.draftVersion, candidates },
    });
    confirmedCount += confirmed.events.length;
  }

  return confirmedCount;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("seed:pilot refuses to run with NODE_ENV=production");
    process.exit(2);
  }

  const options = parseOptions(process.argv.slice(2));
  const runtime = createServerRuntime(loadServerEnv(process.env), "seed-pilot");
  const deps = createRequestDeps(runtime, randomUUID());

  try {
    const owner = await signIn(deps, options.ownerClerkUserId, "Pilot Owner");
    console.info(`owner user id: ${owner.userId}`);

    const daycare = await initializeWorkspace({
      deps,
      userId: owner.userId,
      clerkUserId: options.ownerClerkUserId,
      input: {
        clerkOrgId: options.daycareOrgId,
        kind: "daycare",
        name: "Pilot Daycare",
        timezone: PILOT_TIMEZONE,
      },
    });
    console.info(`daycare workspace id: ${daycare.id}`);

    const households = [];
    for (const [index, orgId] of options.householdOrgIds.entries()) {
      const household = await initializeWorkspace({
        deps,
        userId: owner.userId,
        clerkUserId: options.ownerClerkUserId,
        input: {
          clerkOrgId: orgId,
          kind: "household",
          name: `Pilot Household ${String(index + 1)}`,
          timezone: PILOT_TIMEZONE,
        },
      });
      households.push(household);
      console.info(`household workspace id: ${household.id}`);
    }

    // Reconciled after the workspaces exist, so their Clerk memberships map to local ones.
    const staff = await signIn(deps, options.staffClerkUserId, "Pilot Staff");
    const guardian = await signIn(deps, options.guardianClerkUserId, "Pilot Guardian");
    console.info(`staff user id: ${staff.userId}`);
    console.info(`guardian user id: ${guardian.userId}`);

    for (const [label, joined] of [
      ["staff", staff.workspaceIds],
      ["guardian", guardian.workspaceIds],
    ] as const) {
      if (joined.has(daycare.id)) continue;
      throw new Error(
        `the --${label} account is not a member of the daycare organization in Clerk; ` +
          "add it there and run this script again",
      );
    }

    const daycareChildIds: string[] = [];
    for (const label of DAYCARE_CHILD_LABELS) {
      const child = await createChild({
        deps,
        actorUserId: owner.userId,
        workspaceId: daycare.id,
        input: { name: `Pilot Child ${label}` },
      });
      daycareChildIds.push(child.id);
      console.info(`daycare child id: ${child.id}`);
    }

    for (const [index, childId] of daycareChildIds.entries()) {
      const grants: ChildCaregiverGrant[] = [
        { userId: staff.userId, relationship: "caregiver", permission: "contributor" },
      ];
      // The guardian is a family for the first two children only, so the roster is not uniform.
      if (index < 2) {
        grants.push({ userId: guardian.userId, relationship: "parent", permission: "reader" });
      }
      await updateChildCaregivers({
        deps,
        actorUserId: owner.userId,
        workspaceId: daycare.id,
        childId,
        input: { grants },
      });
    }

    const householdChildIds: string[] = [];
    for (const [index, household] of households.entries()) {
      const label = HOUSEHOLD_CHILD_LABELS[index] ?? String(index);
      const child = await createChild({
        deps,
        actorUserId: owner.userId,
        workspaceId: household.id,
        input: { name: `Pilot Child ${label}` },
      });
      householdChildIds.push(child.id);
      console.info(`household child id: ${child.id}`);
    }

    let confirmedEvents = 0;
    for (const [index, childId] of [...daycareChildIds, ...householdChildIds].entries()) {
      confirmedEvents += await seedWeekOfCare({
        deps,
        // The owner authors the week: they hold manager permission in every workspace here, and
        // the staff grant is what the pilot's own recordings will exercise.
        authorUserId: owner.userId,
        childId,
        childIndex: index,
        today: new Date(),
      });
    }

    console.info(`confirmed events created: ${String(confirmedEvents)}`);
    console.info(`days of synthetic care per child: ${String(PILOT_DAYS)}`);
  } finally {
    await runtime.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ServerEnvError) {
    console.error(`server configuration is incomplete: ${error.variables.join(", ")}`);
    process.exit(78);
  }
  // Message only, never a stack: a service error can name a workspace or a child id.
  console.error(`seed failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
