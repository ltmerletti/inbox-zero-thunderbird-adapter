#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != Darwin ]; then
  echo 'The one-command installer currently supports macOS only.' >&2
  exit 1
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v brew >/dev/null; then
  echo 'Installing Homebrew. macOS may ask for your administrator password.'
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
command -v git >/dev/null || brew install git
brew list node@24 >/dev/null 2>&1 || brew install node@24
export PATH="$(brew --prefix node@24)/bin:$PATH"
test -d /Applications/Docker.app || brew install --cask docker-desktop
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
test -d /Applications/Thunderbird.app || brew install --cask thunderbird

installation="${INBOX_ZERO_INSTALL_DIR:-$HOME/.local/share/inbox-zero-thunderbird}"
adapter="$installation/thunderbird-inbox-zero"
mkdir -p "$installation"
if [ ! -e "$adapter" ]; then
  git clone https://github.com/ltmerletti/inbox-zero-thunderbird-adapter.git "$adapter"
elif [ ! -d "$adapter/.git" ]; then
  echo "Refusing to overwrite $adapter. Choose a different INBOX_ZERO_INSTALL_DIR." >&2
  exit 1
fi
origin="$(git -C "$adapter" remote get-url origin)"
if [ "$origin" != https://github.com/ltmerletti/inbox-zero-thunderbird-adapter.git ] &&
   [ "$origin" != https://github.com/ltmerletti/inbox-zero-thunderbird-adapter ]; then
  echo 'The destination contains a different repository. It will not be executed.' >&2
  exit 1
fi
exec node "$adapter/scripts/install.mjs"
