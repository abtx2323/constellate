#!/usr/bin/env bash
# Creates this project as a PRIVATE GitHub repository, pushes it, confirms it
# really is private, then applies the hardening in harden-repo.sh.
#
#   ./scripts/create-private-repo.sh <repo-name>
#
# Needs the GitHub CLI (gh), signed in as the account that will own the repo.
set -euo pipefail

name="${1:-}"
if [[ ! "$name" =~ ^[A-Za-z0-9._-]{1,100}$ ]]; then
  echo "Usage: $0 <repo-name>   (letters, digits, dot, dash, underscore)" >&2
  exit 2
fi
cd "$(dirname "$0")/.."

command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com" >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js 20 or newer is required." >&2; exit 1; }
gh auth status >/dev/null || { echo "Sign in first with: gh auth login" >&2; exit 1; }

echo "==> Checking the project before anything leaves this machine"
node --test
node scripts/build.mjs --check
node scripts/check-security.mjs

[ -d .git ] || git init -q -b main
git config core.hooksPath .githooks
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "Initial commit"
fi
git branch -M main

echo "==> Creating private repository: $name"
gh repo create "$name" --private --disable-wiki --source=. --remote=origin --push \
  --description "Constellate: a private, offline skill-tree canvas"

visibility="$(gh repo view --json visibility --jq .visibility)"
if [ "$visibility" != "PRIVATE" ]; then
  echo "STOP: the repository is $visibility, not PRIVATE. Fix this in Settings before continuing." >&2
  exit 1
fi
echo "==> Confirmed private"

./scripts/harden-repo.sh
