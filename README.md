# Inbox Zero + Thunderbird

Use Inbox Zero with email connected through Thunderbird, on your own Mac.
Your mail and credentials stay in the local installation. **Mail access is read-only. AI uses the provider and model you configure in
Inbox Zero Settings. The installer does not download or launch a local AI model.**

## Install

Open Terminal, paste this command, and press Return:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/ltmerletti/inbox-zero-thunderbird-adapter/main/install.sh)"
```

The installer handles Homebrew, Git, Node.js 24, Docker Desktop, Thunderbird,
Inbox Zero, the adapter, private configuration, and database setup. Existing
applications are reused. The first installation downloads dependencies and can
take several minutes.

**Currently supports macOS only.** Homebrew's current system requirements apply;
see [Homebrew's installation page](https://docs.brew.sh/Installation). macOS may
ask for an administrator password. If Docker Desktop opens its first-run setup,
complete that setup while the installer waits.

Then finish these two steps:

1. In the Thunderbird window, add **one email account** and complete its normal
   Microsoft sign-in and MFA. Keep the Terminal window open; the installer waits
   for the account and links it automatically.
2. Inbox Zero opens in your browser. Sign in with your email address and the
   **separate local password** that opens in a text window. This is not your
   Microsoft password.

No Microsoft app registration, client-secret editing, or manual database commands
are needed. Your organization must still allow Thunderbird to connect to the
mailbox. This does not bypass its access policies.

## Start it again

Open this folder in Finder:

```text
~/.local/share/inbox-zero-thunderbird/thunderbird-inbox-zero
```

Start Docker Desktop, then double-click **Start Inbox Zero.command**.
Open [Inbox Zero](http://127.0.0.1:3000) and keep Thunderbird open.

Your local password is saved in `.private/local-inbox-zero-password.txt` inside
that folder. The **Stop Thunderbird Adapter.command** stops the adapter's
Thunderbird and bridge processes; it does not stop the database or Inbox Zero.

## If setup stops

Fix the issue printed in Terminal and run the same installation command again.
Completed setup files and passwords are preserved. The installer refuses to
replace a manually configured installation or use ports occupied by another
installation.

If Docker was still starting, open Docker Desktop, wait until it is ready, and
rerun the command. If Thunderbird sign-in took longer than 20 minutes, rerun the
command after completing sign-in.

To use a different installation folder:

```bash
INBOX_ZERO_INSTALL_DIR="$HOME/InboxZero" /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/ltmerletti/inbox-zero-thunderbird-adapter/main/install.sh)"
```

## What works

- Inbox Zero's native mail list and folders, including custom Outlook folders.
- Paginated mail synchronization, basic search, and reading individual messages.
- A separate Thunderbird profile and authenticated local mail bridge.

Sending, deleting, moving, archiving, and changing flags are blocked.
Conversations currently contain one message; attachment downloads are not
implemented. This is a local development installation, not a production service.
The setup supports one mailbox initially.

Thunderbird stores the mailbox's sign-in. The database runs in Docker; Inbox Zero
and the mail bridge run on your Mac and bind to local addresses. Private passwords,
mail data, tokens, profiles, screenshots, and logs are excluded from this repository.

## Updates and development

The installer uses tested upstream revisions in `upstreams.json`. It never
silently upgrades an existing installation. Thunderbird uses a reader extension;
no custom Thunderbird build is required.

GitHub checks the pinned and latest Inbox Zero/bridge source on pushes, pull
requests, manual runs, and weekly. The checks apply the integration patches and
run fake-mailbox tests. They do not connect to email or call an AI model. Breaking
upstream changes can still require a patch update; the checks do not cover every
screen or future Thunderbird release.

For source preparation, configuration details, and update checks, see
[the developer notes](integration/README.md). Run `npm test` for the
bridge/extension/reader test and installer configuration tests.

## Attribution

The app comes from [elie222/inbox-zero](https://github.com/elie222/inbox-zero).
The bridge comes from [vitalio-sh/thunderbird-cli](https://github.com/vitalio-sh/thunderbird-cli).
Their licenses and additional terms are reproduced in `licenses/`.
