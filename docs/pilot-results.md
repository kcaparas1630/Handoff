# Handoff pilot results

> **No pilot has been run.** Every cell below is blank on purpose. This file is a template, not a
> report: there are no participants, no measurements, and no findings. Do not cite it, summarize it,
> or copy a number out of it. Fill it in only after a pilot has actually taken place following
> [the pilot plan](pilot-plan.md).

| Field | Value |
| --- | --- |
| Pilot run | *(not run)* |
| Dates | |
| Build (app version and commit) | |
| Prompt version / model id | |
| Extraction evaluation archived at | |
| Sites recruited / sites approached | |
| Caregivers enrolled | |
| Observer | |

## Baseline (recorded before any install)

| Site | Current handoff method | Median baseline transition time (s) | Observed transitions | Perceived effort (1–5) | Facts typically missed |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
| | | | | | |
| | | | | | |

## Product acceptance metrics

Produced by `pnpm measure:pilot -- --since <day 0>`, then completed by hand where the script reports
that a metric is not instrumented. Copy the script's own caveats into the notes column; do not
replace them with a bare number.

| Metric | Definition | Target (learning threshold) | Value | Denominator | Missing-data count | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Activation | Invited caregivers who accept and complete a first acknowledged handoff within 24 hours / eligible invitations delivered | >=70% | | | | |
| Transition effort | Median time from opening brief to "I know what I need", vs each participant's existing method | >=30% reduction; median <=30 s | | | | Script reports brief `created_at` → `acknowledged_at` only. The comparison against the baseline is observed, not instrumented |
| Useful handoffs | Completed, user-rated useful handoffs / all rated handoffs | >=80% | | | | Not collected by the app; interview only. Record missing-fact explanations below |
| Critical correction rate | Voice drafts needing amount/unit/date/action correction / reviewed voice drafts | <=10%, field-level breakdown | | | | Script value is a PROXY (draft version advanced before confirmation). Field-level breakdown must be observed |
| Continued use | Activated caregivers completing handoffs on >=3 separate pilot days / activated caregivers with >=3 care days | >=60% | | | | Care sessions are self-declared |
| Daycare staff effort | Active seconds recording/reviewing per confirmed event vs baseline | Improvement without more mandatory logging | | | | Not instrumented; timed observation only |
| Variable cost | Transcription + AI + storage/egress attributable to pilot / completed handoffs | Report observed cost and cost at 10x usage | | | | Script reports token and audio-second usage; apply contracted rates to get a cost |
| Commercial signal | Providers requesting continued use or a paid follow-up after seeing their own results | At least two concrete follow-up commitments | | | | Willingness to pay remains a hypothesis |

### Per-field correction breakdown

Only fill this in from observed reviews; the database cannot produce it.

| Field | Corrections observed | Voice drafts reviewed | Notes |
| --- | --- | --- | --- |
| Event kind | | | |
| Amount | | | |
| Unit | | | |
| Date / time | | | |
| Action (planned vs completed, negation) | | | |

## Qualitative findings

### Was important information missing from briefs?

*(one row per reported gap; quote the caregiver's own words)*

| Site | Who reported it | What was missing | Was it in the journal at all? |
| --- | --- | --- | --- |
| | | | |

### Did logging feel burdensome?

| Participant role | Response | Compared with their baseline |
| --- | --- | --- |
| | | |

### Voice versus touch

| Participant role | Which they chose | Why (their words) |
| --- | --- | --- |
| | | |

## Operational events during the pilot

| Date | Event | Impact | Resolution |
| --- | --- | --- | --- |
| | | | |

Include queue stalls, failed uploads, spend-cap warnings, provider outages, and any stop-rule
trigger from [the pilot plan](pilot-plan.md#7-stop-rules).

## Deletion and close-out

| Item | Status |
| --- | --- |
| Every participant workspace deleted through the app | |
| Purge verified (`scripts/verify-purge.ts` output archived) | |
| Provider-side retention explained to participants | |
| Any participant data retained, and why | |

## Conclusions

*(left blank; write these only from what was observed)*

- What the evidence supports:
- What the evidence does not support:
- What the next iteration should reduce or narrow:
- What must not be inferred from a pilot this small:
