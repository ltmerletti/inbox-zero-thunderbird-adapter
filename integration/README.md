# Integration and local setup

`inbox-zero.patch` adds the Thunderbird provider, local password login, native
folder navigation, mail-engine support, and the server-side AI-off guard.
`thunderbird-cli.patch` adds an authenticated read-only bridge mode. Neither patch
contains a mailbox, account identity, OAuth token, or configured password.

The revisions and upstream URLs are in `../upstreams.json`. The preparation script
checks each patch before applying it to a fresh checkout. The existing installation
does not need to rerun that script.

## Private configuration

The current macOS launchers expect these local files:

- `.private/secrets.json` in the adapter. `start.mjs` creates random bridge and
  preview tokens when this file is absent.
- `.env.thunderbird` in Inbox Zero with `POSTGRES_PASSWORD` and `REDIS_HTTP_TOKEN`
  for `compose.thunderbird.yaml`.
- `apps/web/.env.local` in Inbox Zero. Start from its upstream `.env.example`,
  use the local database/cache addresses below, generate your own authentication
  and encryption secrets, and enable the Thunderbird settings.
- `.private/inbox-zero-config.json` in the adapter with a `password` field for
  the local login setup script. Generate a unique local password and save it
  privately. Do not put a Microsoft password here.

The Thunderbird settings in `apps/web/.env.local` must include:

```dotenv
LOCAL_THUNDERBIRD_ENABLED=true
LOCAL_AI_DISABLED=true
THUNDERBIRD_BRIDGE_URL=http://127.0.0.1:7700
THUNDERBIRD_BRIDGE_TOKEN=<http token from local .private/secrets.json>
NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3000
NEXT_PUBLIC_AUTO_DRAFT_DISABLED=true
NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED=true
```

The database listens on `127.0.0.1:5446`, Redis on `127.0.0.1:6386`, and the Redis
HTTP service on `http://127.0.0.1:8076`. Use the same locally generated database
password and Redis HTTP token in the app and Compose configuration. Keep AI API
keys absent. The launcher requires `LOCAL_AI_DISABLED=true` before starting the app.

Install the app dependencies and generate/migrate the Prisma database using Inbox
Zero's setup instructions for the pinned revision. Once Thunderbird is connected
and the database is ready, run `pnpm exec tsx scripts/setup-thunderbird.mts` from
`inbox-zero/apps/web`. It derives the mailbox identity from Thunderbird, creates
the separate local login, and refuses to change conflicting account ownership.
It requires exactly one Thunderbird account for initial setup.

The source preparation and compatibility tests do not perform these private setup
steps. The launchers currently assume Node at `/opt/homebrew/bin/node` and Docker
at `/usr/local/bin/docker`; adjust those paths for another installation.

## Validating an update

Use a fresh directory and `prepare-upstreams.mjs --latest`. Install bridge
dependencies and run the adapter test against the prepared sibling checkouts.
Run the provider tests in Inbox Zero as well before adopting a new app version.
The GitHub compatibility check is intentionally limited to patch application and
the fake-mailbox bridge/reader test.

Never apply an update over uncommitted upstream work. Back up the private database
and Thunderbird profile before changing the working installation. Database schema
changes may require upstream migrations and cannot always be reversed by changing
the source revision.
