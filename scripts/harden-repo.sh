#!/usr/bin/env bash
# Applies security settings to the GitHub repository this folder pushes to,
# then prints an audit. Safe to run again at any time.
#
#   ./scripts/harden-repo.sh [owner/repo]
#
# Some settings depend on your GitHub plan. Those are attempted and reported
# as "not available" instead of failing the run.
set -uo pipefail

repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)}"
if [[ ! "$repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "Could not work out the repository. Pass it as owner/repo." >&2
  exit 2
fi
branch="$(gh api "repos/$repo" --jq .default_branch)" || { echo "Cannot read $repo. Are you signed in as an admin of it?" >&2; exit 1; }

applied=0; skipped=0
try() { # try "label" gh-api-args...
  local label="$1"; shift
  if out="$(gh api "$@" 2>&1 >/dev/null)"; then
    echo "  done            $label"; applied=$((applied + 1))
  else
    echo "  not available   $label  ($(echo "$out" | head -n1 | cut -c1-90))"; skipped=$((skipped + 1))
  fi
}

echo "==> Hardening $repo"

try "keep the repository private" \
  -X PATCH "repos/$repo" -f visibility=private
try "turn off wiki and projects (unused surfaces)" \
  -X PATCH "repos/$repo" -F has_wiki=false -F has_projects=false
try "delete branches after merge" \
  -X PATCH "repos/$repo" -F delete_branch_on_merge=true
try "Dependabot alerts" \
  -X PUT "repos/$repo/vulnerability-alerts"
try "Dependabot security updates" \
  -X PUT "repos/$repo/automated-security-fixes"
try "Actions: allow only workflows and actions from this repository" \
  -X PUT "repos/$repo/actions/permissions" -F enabled=true -f allowed_actions=local_only
try "Actions: read-only token, cannot approve pull requests" \
  -X PUT "repos/$repo/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
try "secret scanning (paid add-on for private repositories)" \
  -X PATCH "repos/$repo" --input - <<<'{"security_and_analysis":{"secret_scanning":{"status":"enabled"}}}'
try "secret scanning push protection (paid add-on for private repositories)" \
  -X PATCH "repos/$repo" --input - <<<'{"security_and_analysis":{"secret_scanning_push_protection":{"status":"enabled"}}}'
try "protect $branch: no force-push, no deletion, linear history, applies to admins" \
  -X PUT "repos/$repo/branches/$branch/protection" --input - <<<'{"required_status_checks":null,"enforce_admins":true,"required_pull_request_reviews":null,"restrictions":null,"required_linear_history":true,"allow_force_pushes":false,"allow_deletions":false}'

echo
echo "==> Audit of $repo"
show() { printf '  %-28s %s\n' "$1" "$2"; }
# Prints the value, or "could not read" when the API refuses or fails.
val() {
  local out
  if out="$(gh api "$@" 2>/dev/null)"; then echo "$out"; else echo "could not read"; fi
}
show "visibility" "$(val "repos/$repo" --jq .visibility)"
show "people with access" "$(val "repos/$repo/collaborators" --jq '[.[].login] | join(", ")')"
show "deploy keys" "$(val "repos/$repo/keys" --jq length)"
show "webhooks" "$(val "repos/$repo/hooks" --jq length)"
show "Actions secrets" "$(val "repos/$repo/actions/secrets" --jq .total_count)"
if pages_err="$(gh api "repos/$repo/pages" 2>&1 >/dev/null)"; then
  show "GitHub Pages" "ENABLED: a Pages site can expose this code publicly. Turn it off."
elif echo "$pages_err" | grep -q "HTTP 404"; then
  show "GitHub Pages" "off"
else
  show "GitHub Pages" "could not read"
fi

echo
echo "$applied settings applied, $skipped not available on this plan or token."
echo "Account-level steps that no script can do for you are listed in SECURITY.md."
