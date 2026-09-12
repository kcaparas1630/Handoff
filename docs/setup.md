# Setup: local development, environment variables, and Android builds

What you need to run Handoff end to end, in the order it has to happen. Nothing here contains a
secret value; every variable is named in `.env.example` and validated at startup by
`packages/server/src/schemas/server-env.ts`, which names a missing variable and never echoes one.

## 1. Tools

- Node 22 and pnpm 10 (`npm i -g pnpm@10`).
- Docker Desktop for the local Postgres (`docker compose up -d` starts container `handoff-pg` on
  port 55432).
- An Expo account and the EAS CLI (`npm i -g eas-cli`, then `eas login`). `eas.json` pins
  `>= 23.2.0`; run `eas --version` and upgrade if older.
- For a physical Android phone: USB debugging or just the ability to install an APK from a link.

Run `pnpm install --frozen-lockfile` once at the repo root.

## 2. Accounts to provision

| Provider | What to create | Feeds |
| --- | --- | --- |
| Clerk | An application with **email code** sign-in enabled (the sign-in screen only uses `email_code`), **Organizations** enabled with users allowed to create organizations (onboarding creates one client-side), and a **custom organization role** for read-only guardians, for example `org:handoff_guardian`. Add a webhook endpoint at `<API URL>/v1/webhooks/clerk` subscribed to `organizationMembership.created/updated/deleted`, `organizationInvitation.created/accepted/revoked`, and `user.deleted`. | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `CLERK_GUARDIAN_ROLE_KEY` |
| Supabase | A project. Only Storage is used unless you also host Postgres there. Use the service-role (server) key. Run `pnpm storage:provision` once to create the private bucket with the product MIME and size limits. | `SUPABASE_URL`, `SUPABASE_STORAGE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` |
| Deepgram | An API key. Worker only. | `DEEPGRAM_API_KEY` |
| Anthropic | An API key. Worker only. | `ANTHROPIC_API_KEY` |
| AWS KMS | Production only. A symmetric key; the runtime identity needs `kms:Encrypt` and `kms:Decrypt` on it and nothing else. Local development uses a random 32-byte key instead. | `PII_KEY_PROVIDER`, `PII_KMS_KEY_ID`, `AWS_REGION` |

The Clerk webhook and invitation redirect both need a URL Clerk can reach. For local work put a
tunnel (ngrok, cloudflared) in front of the API on port 8081 and use that hostname; for a pilot,
deploy the API first and use its public hostname.

## 3. Environment variables

Copy `.env.example` to `.env` at the repo root. Required to start the API at all:

| Variable | Value |
| --- | --- |
| `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` | From the Clerk dashboard |
| `CLERK_GUARDIAN_ROLE_KEY` | The custom role key you created, for example `org:handoff_guardian` |
| `DATABASE_URL` | Login user that inherits `handoff_api` (see section 4) |
| `PII_KEY_PROVIDER` | `development` locally, `kms` in production (`NODE_ENV=production` rejects `development`) |
| `PII_DEV_WRAPPING_KEY_B64` | 32 random bytes, base64. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Never reuse it outside your machine |
| `INVITATION_REDIRECT_URL` | `<public API URL>/accept-invitation` |
| `APP_LINK_PARENTS`, `APP_LINK_DAYCARE` | Absolute URLs shown on the accept-invitation page. Before the apps are in a store, the deep links `handoff-parents://` and `handoff-daycare://` are valid values |

Needed to record voice or attach media (the API boots for manual entry without them):

| Variable | Value |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_STORAGE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` | From Supabase; the bucket name you want `pnpm storage:provision` to create |

Needed by the worker in addition to everything above:

| Variable | Value |
| --- | --- |
| `DATABASE_JOB_DISPATCH_URL` | Login user that inherits `handoff_dispatcher` (section 4) |
| `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY` | Provider keys |

Needed by the migrator only, never by a running process:

| Variable | Value |
| --- | --- |
| `DATABASE_MIGRATION_URL` | A user that owns the schema. Locally the Docker superuser: `postgres://postgres:handoff@localhost:55432/handoff_dev` |

Bundled into the mobile apps (public, never a secret):

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `EXPO_PUBLIC_API_URL` | Where the phone reaches the API. A phone cannot reach `localhost`; use your LAN IP (`http://192.168.x.x:8081`), a tunnel hostname, or the deployed API |

Everything else in `.env.example` has a documented default and can stay blank:
`CLERK_AUTHORIZED_PARTIES` (set in production to the app origins), `TRANSCRIPTION_MODEL_ID`
(`nova-3`), `ANTHROPIC_MODEL_ID` (`claude-opus-5`), `WORKER_CONCURRENCY` (2),
`WORKER_LEASE_SECONDS` (120), `METRICS_FLUSH_SECONDS` (60), `INTERNAL_METRICS_TOKEN` (blank
means the metrics route does not exist), the three `QUOTA_*` caps, and
`WORKSPACE_KEY_RETENTION_DAYS` (30).

### How the variables get loaded

There is no dotenv package. Expo CLI reads a `.env` in the directory it starts from, which for
`pnpm dev:api` is `apps/api` and for `pnpm dev:parents` is `apps/parents`, not the repo root. The
worker reads only the shell environment. The simplest arrangement is one root `.env` loaded into
the shell before any command:

```powershell
Get-Content .env | Where-Object { $_ -match '^\s*[^#][^=]*=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  Set-Item -Path "env:$($name.Trim())" -Value $value.Trim()
}
```

```bash
set -a; source .env; set +a
```

Every process, including Expo, inherits the shell environment. `.env` at any depth is ignored by
Git.

## 4. Database

Migrations create two `NOLOGIN` roles, `handoff_api` (tenant-scoped, no `DELETE`) and
`handoff_dispatcher` (queue and purge). They deliberately do not create login users; you create
those once and grant the roles. Connecting the API as the superuser works but bypasses every
row-level policy, so do not do it even locally.

```text
docker compose up -d
DATABASE_MIGRATION_URL=postgres://postgres:handoff@localhost:55432/handoff_dev pnpm db:migrate
```

Then, as the superuser (`docker exec -it handoff-pg psql -U postgres -d handoff_dev`):

```sql
create role handoff_api_dev login password 'handoff_api_dev';
grant handoff_api to handoff_api_dev;
create role handoff_dispatcher_dev login password 'handoff_dispatcher_dev';
grant handoff_dispatcher to handoff_dispatcher_dev;
```

Which gives, for local development only:

```text
DATABASE_URL=postgres://handoff_api_dev:handoff_api_dev@localhost:55432/handoff_dev
DATABASE_JOB_DISPATCH_URL=postgres://handoff_dispatcher_dev:handoff_dispatcher_dev@localhost:55432/handoff_dev
```

On a hosted Postgres (Supabase or otherwise) run the same four statements with real passwords.
The client uses `prepare: false`, so a transaction pooler is fine.

## 5. Run it locally

In separate terminals, each with the environment loaded (section 3):

| Command | What it starts |
| --- | --- |
| `pnpm dev:api` | Expo dev server for the API routes on port 8081. Check `http://localhost:8081/v1/health` |
| `pnpm dev:worker` | The job worker. It exits with code 78 and names the missing variable if the worker set is incomplete |
| `pnpm dev:parents` or `pnpm dev:daycare` | Metro for one app flavor. Press `a` for an Android emulator, or scan the QR code from a development build on a phone |

The apps use native modules outside Expo Go (audio, SQLite, secure store, image picker, video),
so they need a **development build** installed on the phone or emulator, not Expo Go. Section 6
produces one.

Production-shaped API: `pnpm build:api` then `pnpm --filter @handoff/api start` (Express on
`PORT`, default 3000). The worker host must be able to load sharp: `node -e "require('sharp')"`.
Deployment order and rollback are in the [runbook](runbook.md).

## 6. Android APK with EAS

EAS Build runs in Expo's cloud, which is the only option from Windows (`--local` builds need
macOS or Linux). Both apps have the same three profiles in `eas.json`; the two APK profiles are:

| Profile | Produces | Use it for |
| --- | --- | --- |
| `development` | APK with the dev client; loads JavaScript from your running Metro | Iterating on UI with hot reload |
| `preview` | Standalone APK with the JavaScript bundled | Handing a phone to a tester; no laptop needed |

Each profile selects the EAS environment of the same name, so the two public variables are read
from EAS, not from `.env`. Do this once per app (the `slug` differs, so each is its own EAS
project):

```text
cd apps/parents
eas init
```

`eas init` prints a project id. Because the config is `app.config.ts`, add it by hand:

```ts
extra: { eas: { projectId: "<printed id>" } },
```

Then set the variables for the environments you will build, per app:

```text
eas env:create --environment development --name EXPO_PUBLIC_API_URL --value http://192.168.x.x:8081 --visibility plaintext
eas env:create --environment development --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value pk_test_... --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://<deployed api> --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value pk_test_... --visibility plaintext
```

Build:

```text
eas build --platform android --profile development
eas build --platform android --profile preview
```

Accept the prompt to generate an Android keystore on the first build. When the build finishes,
the CLI prints a download link and a QR code; open it on the phone and install the APK (allow
installs from that source when Android asks). Builds also appear at `expo.dev` under the project.

The `development` APK then connects to Metro: run `pnpm dev:parents` with the phone on the same
network and open the app; it lists the running dev server, or you scan the QR code. Native
changes (a new Expo module or plugin) need a new build; JavaScript changes do not.

Repeat from `cd apps/daycare` for the Daycare flavor.

## 7. First run checklist

1. `GET /v1/health` answers from the URL you put in `EXPO_PUBLIC_API_URL`, from the phone's
   network.
2. Clerk webhook test delivery returns 2xx from `/v1/webhooks/clerk`.
3. Sign in with an email code, create a workspace and a child, add a manual feed entry.
4. Record a short update; the worker log shows `process_capture` succeed and the review screen
   fills in. If it stays on "preparing", read the failed job's `last_error_code` (runbook).
5. Attach a photo; `validate_media` succeeds and the tile shows the picture.
6. Invite a second account from settings; the email link lands on `/accept-invitation` and the
   second phone sees the child.

The operator checklist for a real pilot (evaluation run, backup restore, purge verification)
is in the [milestone 5 report](milestone-5-report.md).
