// Computes the roadmap's product acceptance metrics from the database. Server-side only.
//
//   pnpm measure:pilot -- --since 2026-09-01
//
// It reads with DATABASE_MIGRATION_URL because the numbers are deliberately cross-tenant; the
// restricted API role is scoped to one workspace per transaction and cannot answer these queries.
// Point it at a pilot database, never at a production one you are not authorized to read.
//
// It prints counts, ratios, denominators, and missing-data columns. It never selects a name, an
// email, a transcript, a payload, or a signed URL: every column below is an id, a timestamp, a
// status, or a number. Several roadmap metrics are not instrumented at all, and this script says
// so rather than substituting a number that looks like an answer.
import postgres from "postgres";

const DEFAULT_WINDOW_DAYS = 7;
/** The roadmap's activation window: accept and complete a first acknowledged handoff. */
const ACTIVATION_WINDOW_HOURS = 24;
/** The roadmap's continued-use threshold: handoffs on at least this many separate pilot days. */
const CONTINUED_USE_DAYS = 3;

interface MetricRow {
  metric: string;
  value: string;
  denominator: string;
  missing: string;
}

function parseSince(argv: readonly string[]): Date {
  const index = argv.indexOf("--since");
  if (index === -1) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - DEFAULT_WINDOW_DAYS);
    return since;
  }
  const raw = argv[index + 1];
  const parsed = raw === undefined ? Number.NaN : Date.parse(raw);
  if (Number.isNaN(parsed)) throw new Error("--since expects an ISO date, for example 2026-09-01");
  return new Date(parsed);
}

function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) return "no denominator";
  return `${((numerator / denominator) * 100).toFixed(1)}% (${String(numerator)}/${String(denominator)})`;
}

type Sql = ReturnType<typeof postgres>;

async function activation(sql: Sql, since: Date): Promise<MetricRow> {
  // "Delivered" excludes an invitation that never left pending_send, and a revoked one whose
  // delivery cannot be established from the row alone.
  const [row] = await sql<
    { delivered: string; activated: string; accepted: string; undeliverable: string }[]
  >`
    select
      count(*) filter (
        where status in ('sent', 'accepted', 'expired', 'reconcile_needed')
      )::text as delivered,
      count(*) filter (where status = 'accepted')::text as accepted,
      count(*) filter (where status in ('pending_send', 'revoked'))::text as undeliverable,
      count(*) filter (
        where status = 'accepted'
          and exists (
            select 1 from handoff.handoff_briefs b
             where b.recipient_user_id = invitation_intents.accepted_by_user_id
               and b.acknowledged_at is not null
               and b.acknowledged_at <= invitation_intents.accepted_at
                 + make_interval(hours => ${ACTIVATION_WINDOW_HOURS})
          )
      )::text as activated
    from handoff.invitation_intents
    where created_at >= ${since}
  `;
  const delivered = Number(row?.delivered ?? 0);
  const activated = Number(row?.activated ?? 0);
  return {
    metric: "Activation",
    value: ratio(activated, delivered),
    denominator: `${String(delivered)} delivered invitations`,
    missing: `${String(row?.undeliverable ?? 0)} never sent or revoked (excluded); accepted but not activated: ${String(Number(row?.accepted ?? 0) - activated)}`,
  };
}

async function transitionEffort(sql: Sql, since: Date): Promise<MetricRow> {
  const [row] = await sql<{ median_seconds: string | null; acknowledged: string; total: string }[]>`
    select
      percentile_cont(0.5) within group (
        order by extract(epoch from (acknowledged_at - created_at))
      ) filter (where acknowledged_at is not null)::text as median_seconds,
      count(*) filter (where acknowledged_at is not null)::text as acknowledged,
      count(*)::text as total
    from handoff.handoff_briefs
    where created_at >= ${since}
  `;
  const median = row?.median_seconds;
  const acknowledged = Number(row?.acknowledged ?? 0);
  const total = Number(row?.total ?? 0);
  return {
    metric: "Transition effort",
    // Not instrumented as the roadmap defines it: "time from opening brief to I know what I need"
    // compared with each participant's existing method. Only the server-side interval exists.
    value:
      median == null
        ? "not measured (no acknowledged brief in the window)"
        : `median ${Number(median).toFixed(1)} s from brief created_at to acknowledged_at`,
    denominator: `${String(acknowledged)} acknowledged briefs`,
    missing: `${String(total - acknowledged)} briefs never acknowledged; baseline comparison against each participant's existing method is NOT INSTRUMENTED and must be observed`,
  };
}

function usefulHandoffs(): MetricRow {
  return {
    metric: "Useful handoffs",
    value: "NOT COLLECTED",
    denominator: "no rated handoffs exist",
    missing: "there is no handoff rating field in the schema or the app; collect this by interview",
  };
}

async function criticalCorrectionRate(sql: Sql, since: Date): Promise<MetricRow> {
  const [row] = await sql<{ reviewed: string; edited: string; unreviewable: string }[]>`
    select
      count(*) filter (where input_kind = 'audio' and status = 'confirmed')::text as reviewed,
      count(*) filter (
        where input_kind = 'audio' and status = 'confirmed' and draft_version > 1
      )::text as edited,
      count(*) filter (
        where input_kind = 'audio' and status in ('failed', 'cancelled')
      )::text as unreviewable
    from handoff.captures
    where created_at >= ${since}
  `;
  const reviewed = Number(row?.reviewed ?? 0);
  const edited = Number(row?.edited ?? 0);
  return {
    metric: "Critical correction rate",
    // PROXY. The schema stores a draft version, not which field changed, so an edit to a note and
    // an edit to an amount are indistinguishable here. The roadmap asks for a field-level
    // breakdown of amount/unit/date/action corrections, which this cannot produce.
    value: `${ratio(edited, reviewed)} — PROXY: voice drafts whose draft_version advanced past the worker's first draft before confirmation, not a field-level correction rate`,
    denominator: `${String(reviewed)} confirmed voice captures`,
    missing: `${String(row?.unreviewable ?? 0)} voice captures failed or were cancelled and were never reviewed; field-level breakdown is NOT INSTRUMENTED`,
  };
}

async function continuedUse(sql: Sql, since: Date): Promise<MetricRow> {
  const [row] = await sql<{ eligible: string; continued: string; any_care: string }[]>`
    with care_days as (
      select user_id, count(distinct date_trunc('day', started_at)) as days
        from handoff.care_sessions
       where started_at >= ${since}
       group by user_id
    ), acknowledged_days as (
      select recipient_user_id as user_id,
             count(distinct date_trunc('day', acknowledged_at)) as days
        from handoff.handoff_briefs
       where acknowledged_at is not null and acknowledged_at >= ${since}
       group by recipient_user_id
    )
    select
      (select count(*) from care_days where days >= ${CONTINUED_USE_DAYS})::text as eligible,
      (select count(*) from care_days)::text as any_care,
      (select count(*)
         from acknowledged_days a
         join care_days c on c.user_id = a.user_id
        where a.days >= ${CONTINUED_USE_DAYS} and c.days >= ${CONTINUED_USE_DAYS})::text
        as continued
  `;
  const eligible = Number(row?.eligible ?? 0);
  const continued = Number(row?.continued ?? 0);
  return {
    metric: "Continued use",
    value: ratio(continued, eligible),
    denominator: `${String(eligible)} caregivers with ${String(CONTINUED_USE_DAYS)}+ care days`,
    missing: `${String(Number(row?.any_care ?? 0) - eligible)} caregivers had care days but fewer than ${String(CONTINUED_USE_DAYS)}; care sessions are self-declared, so a caregiver who never tapped Start care is invisible here`,
  };
}

function staffEffort(): MetricRow {
  return {
    metric: "Daycare staff effort",
    value: "NOT INSTRUMENTED",
    denominator: "no active-seconds timing is recorded",
    missing:
      "measuring active seconds per confirmed event needs timed observation; the client metric buffer counts events, not effort, and holds no baseline",
  };
}

async function variableCost(sql: Sql, since: Date): Promise<MetricRow> {
  const [exists] = await sql<{ present: string | null }[]>`
    select to_regclass('handoff.provider_usage')::text as present
  `;
  if (exists?.present == null) {
    return {
      metric: "Variable cost",
      value: "not available (handoff.provider_usage does not exist in this database)",
      denominator: "—",
      missing: "run the milestone 5 migrations, then measure again",
    };
  }

  const [usage] = await sql<{ tokens_in: string; tokens_out: string; audio_seconds: string }[]>`
    select coalesce(sum(tokens_in), 0)::text as tokens_in,
           coalesce(sum(tokens_out), 0)::text as tokens_out,
           coalesce(sum(audio_seconds), 0)::text as audio_seconds
      from handoff.provider_usage
     where day >= ${since.toISOString().slice(0, 10)}::date
  `;
  const [briefs] = await sql<{ acknowledged: string }[]>`
    select count(*)::text as acknowledged
      from handoff.handoff_briefs
     where acknowledged_at is not null and acknowledged_at >= ${since}
  `;
  const acknowledged = Number(briefs?.acknowledged ?? 0);
  return {
    metric: "Variable cost",
    // Usage, not dollars: the table stores consumption, and no contracted provider rate has been
    // recorded for this project. scripts/evaluate-extraction.ts carries the same caveat.
    value: `${usage?.tokens_in ?? "0"} input tokens, ${usage?.tokens_out ?? "0"} output tokens, ${usage?.audio_seconds ?? "0"} audio seconds`,
    denominator: `${String(acknowledged)} acknowledged handoffs`,
    missing:
      "no dollar figure: contracted transcription and AI rates are not recorded here, and storage/egress is not in this table. Multiply by the contracted rates to price it, and by ten for the roadmap's 10x question",
  };
}

function commercialSignal(): MetricRow {
  return {
    metric: "Commercial signal",
    value: "NOT INSTRUMENTED",
    denominator: "—",
    missing:
      "provider follow-up commitments are recorded by the pilot observer in docs/pilot-results.md",
  };
}

function printTable(rows: readonly MetricRow[]): void {
  console.info("| Metric | Value | Denominator | Missing data |");
  console.info("| --- | --- | --- | --- |");
  for (const row of rows) {
    console.info(`| ${row.metric} | ${row.value} | ${row.denominator} | ${row.missing} |`);
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    console.error(
      "DATABASE_MIGRATION_URL is not set. These metrics span every workspace, which the " +
        "restricted API role cannot read.",
    );
    process.exit(78);
  }
  const since = parseSince(process.argv.slice(2));
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    console.info(`Handoff pilot metrics since ${since.toISOString()}`);
    console.info(
      "All thresholds in the roadmap are learning thresholds. A small pilot is directional.",
    );
    console.info("");
    printTable([
      await activation(sql, since),
      await transitionEffort(sql, since),
      usefulHandoffs(),
      await criticalCorrectionRate(sql, since),
      await continuedUse(sql, since),
      staffEffort(),
      await variableCost(sql, since),
      commercialSignal(),
    ]);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(`measurement failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
