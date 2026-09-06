# Handoff

A voice-assisted care journal built around the next caregiver's handoff.

Architecture package, prepared September 5, 2026:

- [Architecture and data flows](docs/architecture.md): product scope, service boundaries, Mermaid diagrams, recording pipeline, handoff semantics, state management, and repository layout.
- [Database and API contract](docs/data-contract.md): tables, constraints, access rules, event examples, and endpoints.
- [Implementation roadmap](docs/implementation-roadmap.md): five incremental milestones with exact files, logic boundaries, and measurable acceptance gates.
- [Developer handoff](docs/developer-handoff.md): execution instructions for the implementing model.
- [Architecture questions](docs/architecture-questions.md): languages, platforms, checklists, agent security, and schema evolution.
- [Experience design](docs/experience-design.md): care dashboard, inviting voice capture, quick entry, handoff presentation, and usability gates.
- [PII encryption](docs/pii-encryption.md): encrypt before Postgres writes, authorize before server decryption, external key management, rotation, and recovery.
- [Operations runbook](docs/runbook.md): process split, the sharp native binary requirement, storage bucket limits, the worker's job kinds, known media limitations, and triage.
- [Agent conventions](AGENTS.md): repository instructions, also available through the `CLAUDE.md` symlink; [research rationale](docs/conventions-rationale.md).

Milestones 1 through 3 are implemented; see the [milestone 1](docs/milestone-1-report.md), [milestone 2](docs/milestone-2-report.md), and [milestone 3](docs/milestone-3-report.md) reports for what was verified and what remains. Milestones 4 and 5 are still blueprint. No speech or AI provider has been called yet; run `pnpm eval:extraction` with keys before trusting extraction quality. Performance and product metrics in the roadmap are proposed acceptance targets, not measured results.

Local development: `docker compose up -d`, copy `.env.example` to `.env` and fill it, then `DATABASE_MIGRATION_URL=… pnpm db:migrate`, `pnpm dev:api`, and `pnpm dev:parents` or `pnpm dev:daycare`.

`CLAUDE.md` is stored as a relative Git symlink to `AGENTS.md`. This Windows checkout currently lacks symlink privilege and uses Git's link-text fallback; read `AGENTS.md` directly until native symlink support is available. The repository link remains mode `120000`. [Git symlink checkout behavior](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresymlinks)
