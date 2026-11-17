import test from 'node:test';
import assert from 'node:assert/strict';

import { KDF_ITERATIONS, passphraseProblem, isEnvelope, seal, unseal, createVaultKey, vaultKeyFor, sealWithKey, unsealWithKey } from '../src/core/vault.js';

const PASS = 'correct horse battery staple';
const SECRET = JSON.stringify({ v: 1, title: 'Private plans ✨', nodes: [], links: [] });

test('seal and unseal round-trip', async () => {
  const env = await seal(SECRET, PASS);
  assert.ok(isEnvelope(env));
  assert.equal(env.iterations, KDF_ITERATIONS);
  assert.ok(KDF_ITERATIONS >= 600000);
  assert.equal(await unseal(env, PASS), SECRET);
});

test('the envelope does not contain the plaintext', async () => {
  const text = JSON.stringify(await seal(SECRET, PASS));
  assert.ok(!text.includes('Private plans'));
  assert.ok(!text.includes(PASS));
});

test('a wrong passphrase fails cleanly', async () => {
  const env = await seal(SECRET, PASS);
  await assert.rejects(() => unseal(env, 'wrong horse battery staple'), /Wrong passphrase/);
});

test('any tampering is detected', async () => {
  const env = await seal(SECRET, PASS);
  const flip = (b64) => (b64[0] === 'A' ? 'B' : 'A') + b64.slice(1);
  await assert.rejects(() => unseal({ ...env, data: flip(env.data) }, PASS), /Wrong passphrase|changed/);
  await assert.rejects(() => unseal({ ...env, iv: flip(env.iv) }, PASS), /Wrong passphrase|changed/);
  await assert.rejects(() => unseal({ ...env, salt: flip(env.salt) }, PASS), /Wrong passphrase|changed/);
});

test('malformed envelopes are rejected before any key work', async () => {
  const env = await seal(SECRET, PASS);
  await assert.rejects(() => unseal({ ...env, iterations: 1 }, PASS), /damaged/);
  await assert.rejects(() => unseal({ ...env, iterations: 9e9 }, PASS), /damaged/);
  await assert.rejects(() => unseal({ ...env, iv: 'AAAA' }, PASS), /damaged/);
  await assert.rejects(() => unseal({ ...env, salt: '!!!' }, PASS), /damaged/);
  await assert.rejects(() => unseal({ ...env, kdf: 'MD5' }, PASS), /cannot read/);
  await assert.rejects(() => unseal({ ...env, v: 2 }, PASS), /cannot read/);
  assert.equal(isEnvelope({ v: 1, nodes: [] }), false);
  assert.equal(isEnvelope(null), false);
});

test('a session key gives a fresh IV on every save', async () => {
  const key = await createVaultKey(PASS);
  const a = await sealWithKey(key, SECRET);
  const b = await sealWithKey(key, SECRET);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
  assert.equal(a.salt, b.salt);
  const reopened = await vaultKeyFor(PASS, a);
  assert.equal(await unsealWithKey(reopened, b), SECRET);
  assert.equal(key.key.extractable, false);
});

test('two seals of the same data never share a salt', async () => {
  const a = await seal(SECRET, PASS);
  const b = await seal(SECRET, PASS);
  assert.notEqual(a.salt, b.salt);
});

test('weak passphrases are refused', () => {
  assert.ok(passphraseProblem('short'));
  assert.ok(passphraseProblem('aaaaaaaaaaaa'));
  assert.ok(passphraseProblem(''));
  assert.ok(passphraseProblem(undefined));
  assert.ok(passphraseProblem('x'.repeat(300)));
  assert.equal(passphraseProblem(PASS), '');
});
