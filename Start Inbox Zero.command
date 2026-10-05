#!/bin/zsh
set -e
cd "${0:A:h}"
export PATH="/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker compose -f ../inbox-zero/compose.thunderbird.yaml --env-file ../inbox-zero/.env.thunderbird up -d --wait
node start.mjs
exec node start-inbox-zero.mjs
