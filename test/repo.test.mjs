import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { build } from '../scripts/build.mjs';
import { findSecrets } from '../scripts/check-security.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the single-file build pins its script and style by hash', () => {
  const html = build();
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const h = (t) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`;
  assert.ok(csp.includes(`script-src ${h(script)}`));
  assert.ok(csp.includes(`style-src ${h(style)}`));
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(!/src=|href="(?!data:,)/.test(html), 'no outside resources');
  assert.ok(!script.includes('import ') || !/^\s*import\s/m.test(script), 'imports are bundled away');
});

test('the committed single-file build matches the source', () => {
  assert.equal(readFileSync(join(root, 'dist/constellate.html'), 'utf8'), build());
});

test('the embed build drops only the CSP tag', () => {
  const html = build({ embed: true });
  assert.ok(!html.includes('Content-Security-Policy'));
  assert.ok(html.includes('data-embed'));
});

test('the secret scanner recognises common credential shapes', () => {
  // Built at runtime so this file never contains a literal that looks like a secret.
  const samples = [
    'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
    'gh' + 'p_' + 'a'.repeat(36),
    'github' + '_pat_' + 'b'.repeat(50),
    '-----BEGIN RSA ' + 'PRIVATE KEY-----',
    'xo' + 'xb-' + '123456789012-abcdef',
    'sk' + '_live_' + 'c'.repeat(24),
    'pass' + 'word = "' + 'hunter2hunter2' + '"',
  ];
  for (const s of samples) assert.ok(findSecrets(s).length > 0, `missed: ${s.slice(0, 8)}…`);
  assert.deepEqual(findSecrets('const passphrase = el("input");'), []);
  assert.deepEqual(findSecrets('nothing to see here'), []);
});

test('the repository passes its own security policy', () => {
  const out = execFileSync('node', ['scripts/check-security.mjs'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /Security check passed/);
});
