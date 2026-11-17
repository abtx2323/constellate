#!/usr/bin/env node
// Repository policy check. Runs in CI and in the pre-commit hook. No dependencies.
//
// 1. App source must not contain network calls, dynamic code, or markup injection.
// 2. No external web addresses in anything the browser loads.
// 3. The page must ship a strict Content-Security-Policy.
// 4. No secrets or key files in tracked or staged files.
// 5. Workflows must use least privilege and pin any action to a full commit SHA.
//
//   node scripts/check-security.mjs            check the working tree
//   node scripts/check-security.mjs --staged   check only what is staged for commit

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staged = process.argv.includes('--staged');
const problems = [];
const fail = (file, message) => problems.push(`${file}: ${message}`);

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// --- 1 and 2: browser code ---------------------------------------------------

const FORBIDDEN = [
  [/\bfetch\s*\(/, 'network call (fetch)'],
  [/XMLHttpRequest/, 'network call (XMLHttpRequest)'],
  [/\bWebSocket\b/, 'network call (WebSocket)'],
  [/\bEventSource\b/, 'network call (EventSource)'],
  [/sendBeacon/, 'network call (sendBeacon)'],
  [/\bRTCPeerConnection\b/, 'network call (WebRTC)'],
  [/\bimportScripts\b/, 'remote script loading'],
  [/\bimport\s*\(/, 'dynamic import'],
  [/\beval\s*\(/, 'eval'],
  [/new\s+Function\b/, 'new Function'],
  [/set(?:Timeout|Interval)\s*\(\s*['"`]/, 'string passed to a timer'],
  [/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser|srcdoc/, 'markup injection'],
  [/document\.cookie/, 'cookie access'],
  [/\bhttps?:\/\//i, 'external web address'],
  [/serviceWorker/, 'service worker'],
];

const browserFiles = [...walk('src'), 'index.html', 'styles.css'];
for (const file of browserFiles) {
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [pattern, label] of FORBIDDEN) {
      if (pattern.test(line)) fail(`${file}:${i + 1}`, label);
    }
  });
}
for (const file of walk('src')) {
  if (!/^src\/(core|ui)\/[a-z]+\.js$/.test(file)) fail(file, 'unexpected file in src/');
}
if (/\bon[a-z]+\s*=\s*["']/i.test(readFileSync(join(root, 'index.html'), 'utf8'))) fail('index.html', 'inline event handler');
if (/url\s*\(|@import/i.test(readFileSync(join(root, 'styles.css'), 'utf8'))) fail('styles.css', 'stylesheet loads another resource');

// --- 3: Content-Security-Policy ----------------------------------------------

function checkCsp(file, html, hashed) {
  const m = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  if (!m) return fail(file, 'missing Content-Security-Policy');
  const csp = m[1];
  const need = ["default-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'", "require-trusted-types-for 'script'"];
  for (const part of need) if (!csp.includes(part)) fail(file, `CSP is missing ${part}`);
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", '*', 'http:', 'https:']) {
    if (csp.includes(bad)) fail(file, `CSP must not contain ${bad}`);
  }
  if (hashed && !/script-src 'sha256-[A-Za-z0-9+/=]+'(;|$)/.test(csp)) fail(file, 'script-src must be a single SHA-256 hash');
  if (!hashed && !/script-src 'self'(;|$)/.test(csp)) fail(file, "script-src must be exactly 'self'");
}
checkCsp('index.html', readFileSync(join(root, 'index.html'), 'utf8'), false);
if (existsSync(join(root, 'dist/constellate.html'))) {
  const dist = readFileSync(join(root, 'dist/constellate.html'), 'utf8');
  checkCsp('dist/constellate.html', dist, true);
  if (/<script[^>]+src=|<link[^>]+href="(?!data:,")|<iframe|<object|<embed/i.test(dist)) fail('dist/constellate.html', 'loads an outside resource');
}

// --- 4: secrets ----------------------------------------------------------------

const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{40,}/, 'GitHub fine-grained token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/sk_live_[0-9A-Za-z]{20,}/, 'Stripe live key'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JSON web token'],
  [/(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, 'hard-coded credential'],
];
const SECRET_FILES = /(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.keystore|credentials\.json|.*\.constellate\.json)$/i;

export function findSecrets(text) {
  const hits = [];
  for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(text)) hits.push(label);
  return hits;
}

let tracked = git(staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files', '--cached', '--others', '--exclude-standard']);
if (tracked === null) tracked = '';
for (const file of tracked.split('\n').filter(Boolean)) {
  if (SECRET_FILES.test(file) && file !== '.env.example') fail(file, 'secret or key file must not be committed');
  let text;
  if (staged) text = git(['show', `:${file}`]);
  else if (existsSync(join(root, file))) text = readFileSync(join(root, file), 'utf8');
  if (!text || text.includes('\u0000')) continue;
  text.split('\n').forEach((line, i) => {
    for (const label of findSecrets(line)) fail(`${file}:${i + 1}`, `possible ${label}`);
  });
}

// --- 5: workflows --------------------------------------------------------------

const wfDir = '.github/workflows';
if (existsSync(join(root, wfDir))) {
  for (const file of walk(wfDir)) {
    const text = readFileSync(join(root, file), 'utf8');
    if (!/^permissions:\s*$/m.test(text) && !/^permissions:\s*\{\s*\}\s*$/m.test(text) && !/^permissions:\s*read-all\s*$/m.test(text)) fail(file, 'needs a top-level permissions block');
    if (/pull_request_target|workflow_run/.test(text)) fail(file, 'must not use pull_request_target or workflow_run');
    if (/:\s*write\b/.test(text)) fail(file, 'must not request write permissions');
    for (const m of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      if (!/^\.\//.test(m[1]) && !/@[0-9a-f]{40}$/.test(m[1])) fail(file, `action ${m[1]} must be pinned to a full commit SHA`);
    }
    if (/\$\{\{\s*github\.event\.(issue|pull_request|comment|head_commit|review)\b[^}]*\}\}/.test(text)) fail(file, 'must not interpolate event text into a script');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (problems.length) {
    console.error(`Security check failed (${problems.length}):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`Security check passed: ${browserFiles.length} browser files, ${tracked.split('\n').filter(Boolean).length} files scanned for secrets.`);
}
