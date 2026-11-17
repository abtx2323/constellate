#!/usr/bin/env node
// Builds dist/constellate.html: the whole app in one file that works offline
// by double-click. No dependencies. The file's Content-Security-Policy pins
// the exact script and style by SHA-256 hash, so nothing else can run in it.
//
//   node scripts/build.mjs            write dist/constellate.html
//   node scripts/build.mjs --check    fail if dist/ is out of date
//   node scripts/build.mjs --embed F  write F without a CSP meta tag, for hosts
//                                     that wrap the page and set their own policy

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Dependency order. Every module keeps unique top-level names so they can share one scope.
const MODULES = [
  'src/core/model.js',
  'src/core/progress.js',
  'src/core/layout.js',
  'src/core/vault.js',
  'src/core/templates.js',
  'src/ui/renderer.js',
  'src/ui/dom.js',
  'src/ui/app.js',
];

function bundle() {
  const parts = [];
  const seen = new Map();
  for (const file of MODULES) {
    const out = [];
    for (const line of read(file).split('\n')) {
      if (/^import\s/.test(line)) {
        if (!/^import \{[^}]*\} from '\.[^']*';$/.test(line)) throw new Error(`${file}: only single-line named imports are supported: ${line}`);
        continue;
      }
      if (/^export\s+(default|\{|\*)/.test(line)) throw new Error(`${file}: only "export const/function" is supported: ${line}`);
      const stripped = line.replace(/^export\s+(?=(async\s+)?(const|let|function|class)\s)/, '');
      const decl = /^(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/.exec(stripped);
      if (decl) {
        if (seen.has(decl[1])) throw new Error(`"${decl[1]}" is declared in both ${seen.get(decl[1])} and ${file}`);
        seen.set(decl[1], file);
      }
      out.push(stripped);
    }
    parts.push(`// ---- ${file} ----\n${out.join('\n')}`);
  }
  const js = `(() => {\n'use strict';\n${parts.join('\n')}\n})();\n`;
  if (js.includes('</script')) throw new Error('Source must not contain a closing script tag.');
  return js;
}

const hash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

function swap(html, name, replacement) {
  const start = `<!--${name}-->`;
  const end = `<!--/${name}-->`;
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error(`index.html is missing the ${name} markers`);
  return html.slice(0, a) + replacement + html.slice(b + end.length);
}

export function build(options) {
  const embed = Boolean(options && options.embed);
  const js = bundle();
  const css = read('styles.css');
  if (css.includes('</style')) throw new Error('Styles must not contain a closing style tag.');
  const csp = [
    "default-src 'none'",
    `script-src ${hash(js)}`,
    `style-src ${hash(css)}`,
    'img-src blob: data:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "require-trusted-types-for 'script'",
  ].join('; ');
  let html = read('index.html');
  html = swap(html, 'CSP', embed ? '' : `<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  if (embed) html = html.replace('<html lang="en">', '<html lang="en" data-embed>');
  html = swap(html, 'STYLE', `<style>${css}</style>`);
  html = swap(html, 'SCRIPT', `<script>${js}</script>`);
  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const target = join(root, 'dist/constellate.html');
  if (args[0] === '--embed') {
    if (!args[1]) throw new Error('Usage: build.mjs --embed <output file>');
    writeFileSync(args[1], build({ embed: true }));
    console.log(`Wrote ${args[1]} (no CSP meta tag)`);
  } else if (args[0] === '--check') {
    let current = '';
    try { current = readFileSync(target, 'utf8'); } catch { /* missing */ }
    if (current !== build()) {
      console.error('dist/constellate.html is out of date. Run: node scripts/build.mjs');
      process.exit(1);
    }
    console.log('dist/constellate.html is up to date.');
  } else {
    mkdirSync(dirname(target), { recursive: true });
    const html = build();
    writeFileSync(target, html);
    console.log(`Wrote dist/constellate.html (${(html.length / 1024).toFixed(1)} KB)`);
  }
}
