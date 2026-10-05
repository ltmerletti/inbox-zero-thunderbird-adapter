# Inbox Zero + Thunderbird

A local, read-only Thunderbird adapter for the actual Inbox Zero app.
Thunderbird handles the email account's Microsoft sign-in; an authenticated
bridge on this computer supplies mail to Inbox Zero. **AI is disabled.**

## Start

1. Start Docker Desktop.
2. Double-click `Start Inbox Zero.command`.
3. Open http://127.0.0.1:3000 and keep Thunderbird open.

Inbox Zero uses a separate local login. Its password is saved privately in
`.private/local-inbox-zero-password.txt`, not in Git.

## What works

- Inbox Zero's native mail list and folder views, including custom Outlook folders.
- Paginated metadata synchronization, basic search, and individual message bodies.
- Account isolation and message references that handle Thunderbird ID changes.

Sending, moving, archiving, deleting, and changing flags are blocked. Conversations
currently contain one message; attachment downloads are not implemented. No AI
model or LM Studio is launched. This is a local development installation.

## Project layout

This repository contains the launchers, reader extension, tests, diagnostic
preview, and the complete source patches for the Inbox Zero provider and
read-only bridge. `upstreams.json` records the tested upstream revisions.
Thunderbird itself is not patched or built from source.

The launchers use adjacent `../inbox-zero` and `../thunderbird-cli` checkouts.
The reader extension's source lives here and is not overwritten from an upstream
checkout when you start the adapter. `../thunderbird-source` is not required.

The actual app runs on port **3000**. Port **3001** is the diagnostic preview;
the authenticated mail bridge uses ports **7700/7701**, bound to 127.0.0.1.

Run the bridge/reader tests with `npm test`. Tests use fake Thunderbird APIs and
do not invoke AI or contact a real mailbox.

Credentials, the Thunderbird profile and downloaded app, generated extension
packages, screenshots, and logs are excluded from Git.

## Prepare a new installation

Use Node.js 24 or newer. Clone this repository into a folder named
`thunderbird-inbox-zero`, then run this command inside it:

```sh
node scripts/prepare-upstreams.mjs
```

It clones the two upstream repositories next to this one, checks out the pinned
revisions, and applies the integration patches. It refuses to overwrite existing
checkouts. It does not start services, connect email, or load AI models.

This prepares the source, not a complete unattended installation. Install the
dependencies with `pnpm install` in Inbox Zero and `npm ci` in thunderbird-cli.
The macOS launchers also need Docker Desktop, a Thunderbird app at
`Thunderbird.app`, and private local configuration. See
[the local setup notes](integration/README.md) for the configuration requirements.
Never copy another installation's profile, tokens, database, or password.

## Updates

The default setup stays on tested revisions. It does not automatically upgrade
Inbox Zero or change the running mailbox installation.

To check newer upstream code separately:

```sh
node scripts/prepare-upstreams.mjs --latest --directory /tmp/inbox-zero-update-check
```

Use an unused directory each time. Patch application fails if upstream changes
conflict with this integration. The existing checkouts remain untouched.

GitHub Actions checks both the pinned revisions and the upstream default branches
on pushes, pull requests, manual runs, and weekly. It applies the patches and runs
the real bridge/extension/reader integration test with fictional email. It does
not launch Inbox Zero, Thunderbird, or an AI model, and does not access a mailbox.
Passing this check verifies patch application and the bridge/reader contract. It
does not prove that every Inbox Zero screen or a new Thunderbird release works.

Thunderbird uses its public MailExtension APIs, so ordinary updates do not need a
custom Thunderbird build. Inbox Zero still needs a provider integration; breaking
upstream changes can require a patch update. Maintenance-free compatibility cannot
be guaranteed. Keep the working versions until an update is tested.

## Upstream attribution

Inbox Zero comes from [elie222/inbox-zero](https://github.com/elie222/inbox-zero).
Its patched source retains its upstream license and additional terms, reproduced
in `licenses/inbox-zero.txt`. The bridge comes from
[vitalio-sh/thunderbird-cli](https://github.com/vitalio-sh/thunderbird-cli) under
the MIT license, reproduced in `licenses/thunderbird-cli.txt`.
