# Security

Constellate holds something personal: what you are trying to get better at and how it is going. This document says what protects it, what does not, and what only you can do.

## Reporting a problem

This is a private repository. Open an issue in it, or contact the owner directly. Do not put secrets or personal chart data in an issue.

## The app

| Risk | What stops it |
|---|---|
| Data leaving the device | The app has no network code. The page's Content-Security-Policy sets `default-src 'none'` and `connect-src 'none'`, so the browser blocks any request even if code tried one. |
| Injected script | No inline handlers, no `eval`, no markup injection anywhere. The policy adds `require-trusted-types-for 'script'`, so supporting browsers refuse string-to-markup assignment outright. The single-file build allows exactly one script and one stylesheet, each pinned by SHA-256 hash. |
| A hostile backup file | `sanitizeChart` rebuilds every import field by field with hard limits on counts and sizes. Unknown fields are dropped. Links that would form a loop are refused. Only `http` and `https` addresses survive, and they open with `noopener noreferrer`. |
| Someone reading the saved chart | Optional passphrase lock: AES-256-GCM, key from PBKDF2-SHA-256 at 600,000 iterations with a random 16-byte salt, fresh 12-byte IV on every save, key marked non-extractable. Encrypted backups use the same format. |
| A tampered encrypted file | AES-GCM authentication rejects any change. Envelope fields are validated before any key work, including a ceiling on iterations so a crafted file cannot stall the browser. |
| Compromised dependency | There are none, at runtime or at build time. |

### Limits you should know

- **Without a passphrase the chart is stored as plain text** in the browser. Anyone with access to your browser profile can read it.
- **While the chart is unlocked it is in memory.** A malicious browser extension, or malware on the device, can read it. Encryption protects data at rest, not a compromised machine.
- **A weak passphrase can be guessed offline** by someone who copies the encrypted data. Use several random words.
- **There is no passphrase reset.** Keep an encrypted backup somewhere safe.
- **Pictures and plain backups are not encrypted.** They contain skill names and progress.
- Trusted Types is enforced by Chromium-based browsers. A browser without it ignores that one directive; the rest of the policy still applies.

## The repository

Checked into the repository and enforced on every push:

| Control | Where |
|---|---|
| Tests, build check and policy check on every push and pull request | `.github/workflows/ci.yml` |
| Workflow token is read-only and the job uses no secrets | `permissions: contents: read` |
| No marketplace actions: checkout is plain `git`, so no third-party code runs in CI | `.github/workflows/ci.yml` |
| Policy check: no network calls, dynamic code or markup injection in app code; strict CSP present; no secrets or key files; any action that is ever added must be pinned to a full commit SHA | `scripts/check-security.mjs` |
| The same check before each commit | `.githooks/pre-commit` (enable with `git config core.hooksPath .githooks`) |
| Secret and key files ignored by default, including chart backups | `.gitignore` |
| Updates for any action added later | `.github/dependabot.yml` |
| Owner review on every path | `.github/CODEOWNERS` |

Applied to the GitHub repository by `scripts/harden-repo.sh`:

- visibility set to private and verified
- wiki and projects turned off
- Dependabot alerts and security updates on
- Actions limited to workflows and actions that live in this repository
- default Actions token read-only, and unable to approve pull requests
- secret scanning and push protection, where the plan includes them
- default branch protected against force-pushes and deletion, with linear history, including for admins, where the plan includes it

The script prints which settings were applied and which were not available, then an audit: visibility, who has access, deploy keys, webhooks, Actions secrets and whether GitHub Pages is on.

### Plan-dependent features

GitHub's documentation lists secret scanning, push protection and code scanning as free for public repositories and as paid add-ons (GitHub Secret Protection and GitHub Code Security, on Team and Enterprise plans) for private ones. Protected branches on private repositories also depend on the account's plan. Where a feature is missing, the pre-commit hook and the CI secret scan in this repository are the fallback. They match common credential formats; they are not a replacement for GitHub's scanner.

## What only you can do

A private repository is exactly as safe as the accounts that can reach it.

1. **Turn on two-factor authentication** for your GitHub account, ideally a passkey or hardware key, and store the recovery codes offline.
2. **Review who has access** (Settings → Collaborators). Remove anyone who does not need it.
3. **Prefer fine-grained personal access tokens** limited to this repository, with an expiry. Delete tokens you no longer use.
4. **Review authorized OAuth and GitHub Apps** (account Settings → Applications). Each one with repository access is another way in.
5. **Protect your SSH keys with a passphrase** and remove old keys from your account.
6. **Sign your commits** and turn on vigilant mode so unsigned commits are flagged.
7. **Do not enable GitHub Pages** for this repository. A Pages site built from a private repository is public on most plans.
8. **Never commit a chart backup.** `*.constellate.json` is ignored for that reason.
9. **Keep the device itself safe:** disk encryption, a screen lock, and a browser profile you do not share.

## What this does not claim

No software is secure in every respect, and this document does not say otherwise. The claims above are the ones backed by code and tests in this repository. The CI workflow's manual checkout step has not yet been exercised on GitHub's runners from this copy; the first push will confirm it.
