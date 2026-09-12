# Handoff

Handoff is a care journal for babies and young children, built around one question the next
caregiver always has: **"What do I need to know before I take over?"**

## Who it is for

- **Parents and household caregivers** who share the care of a child and need the next person to
  know what happened: when the last feed was, how long the nap lasted, what the diaper looked
  like, and what was planned but not yet done.
- **Small daycares** where staff hand children between each other during the day and to a parent
  at pickup, and where the parent wants to read the day rather than reconstruct it from a paper
  sheet or a message thread.

Two app flavors ship from one codebase: a Parents app for households and invited guardians, and a
Daycare app for staff. Both target iOS and Android.

## What it does

- **Record an update by voice.** A caregiver taps Record, says a few things ("Fed 60 ml at two,
  then a wet diaper"), and reviews the events the app extracted before anything is saved. Nothing
  is published without that review. Unknown amounts stay unknown, a plan is never recorded as
  something that happened, and an ambiguous time is asked about rather than guessed.
- **Enter care by touch just as easily.** Feed, diaper, sleep, milestone, and note entries take a
  few taps with no invented defaults, and they work when voice is unavailable.
- **Read a handoff, not a log.** The next caregiver opens a brief that shows the latest known
  feed, sleep, and diaper, everything that changed since they last caught up (including
  corrections), reported moments, and pending recordings. Every line links to its source entry.
  They explicitly acknowledge it and can start their own care session; opening the app is never
  treated as having read it.
- **Care together.** Several caregivers can be active for one child at the same time. Each person
  has their own handoff cursor, so a late upload or a correction from earlier in the day still
  reaches everyone who has not seen it.
- **Attach photos and short videos** to a confirmed update, with location metadata stripped and
  access limited to people who can see that child.
- **Keep the data private.** Names, notes, transcripts, and care details are encrypted before they
  reach the database, decrypted only after the server has checked who is asking, and deleted along
  with their files when a child or workspace is removed.

## What it is not

Handoff is not attendance, billing, messaging, medical guidance, or a task manager. A care
session records that a person says they are caring; it is not a custody or pickup authorization.
The AI only proposes draft entries from a transcript; it has no tools, no database access, and no
say in who can see what.

## Status

All five milestones are implemented as engineering work; see the [milestone 1](docs/milestone-1-report.md), [milestone 2](docs/milestone-2-report.md), [milestone 3](docs/milestone-3-report.md), [milestone 4](docs/milestone-4-report.md), and [milestone 5](docs/milestone-5-report.md) reports for what was verified and what remains. No pilot has run and no external provider has been called; the milestone 5 report lists the operator checklist that comes first. Run `pnpm eval:extraction` with keys before trusting extraction quality. Performance and product metrics in the roadmap are proposed acceptance targets, not measured results.

## Documentation

- [Architecture and data flows](docs/architecture.md): product scope, service boundaries, Mermaid diagrams, recording pipeline, handoff semantics, state management, and repository layout.
- [Database and API contract](docs/data-contract.md): tables, constraints, access rules, event examples, and endpoints.
- [Implementation roadmap](docs/implementation-roadmap.md): five incremental milestones with exact files, logic boundaries, and measurable acceptance gates.
- [Developer handoff](docs/developer-handoff.md): execution instructions for the implementing model.
- [Architecture questions](docs/architecture-questions.md): languages, platforms, checklists, agent security, and schema evolution.
- [Experience design](docs/experience-design.md): care dashboard, inviting voice capture, quick entry, handoff presentation, and usability gates.
- [PII encryption](docs/pii-encryption.md): encrypt before Postgres writes, authorize before server decryption, external key management, rotation, and recovery.
- [Operations runbook](docs/runbook.md): process split, the sharp native binary requirement, storage bucket limits, the worker's job kinds, known media limitations, and triage.
- [Setup](docs/setup.md): environment variables, database roles, local run, and EAS Android builds.
- [Pilot plan](docs/pilot-plan.md) and [pilot results template](docs/pilot-results.md).
- [Agent conventions](AGENTS.md): repository instructions, also available through the `CLAUDE.md` symlink; [research rationale](docs/conventions-rationale.md).

## Local development

Follow [docs/setup.md](docs/setup.md): it lists every environment variable and where it comes from, the database login users to create, how to run the API, worker, and apps locally, and how to build an Android APK with EAS.

`CLAUDE.md` is stored as a relative Git symlink to `AGENTS.md`. This Windows checkout currently lacks symlink privilege and uses Git's link-text fallback; read `AGENTS.md` directly until native symlink support is available. The repository link remains mode `120000`. [Git symlink checkout behavior](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresymlinks)
