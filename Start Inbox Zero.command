#!/bin/zsh
set -e
cd "${0:A:h}"
/usr/local/bin/docker compose -f ../inbox-zero/compose.thunderbird.yaml --env-file ../inbox-zero/.env.thunderbird up -d
/opt/homebrew/bin/node start.mjs
exec /opt/homebrew/bin/node start-inbox-zero.mjs
