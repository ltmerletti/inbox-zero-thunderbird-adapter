#!/bin/zsh
cd "${0:A:h}"
export PATH="/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec node start.mjs
