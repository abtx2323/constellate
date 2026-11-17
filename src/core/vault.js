// Passphrase encryption for saved charts and backups.
// AES-256-GCM, key from PBKDF2-SHA-256. Uses the platform Web Crypto API only.

export const VAULT_FORMAT = 'constellate-vault';
export const KDF_ITERATIONS = 600000;
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 5000000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MAX_CIPHER_CHARS = 8 * 1024 * 1024;
const AAD = new TextEncoder().encode('constellate-vault:v1');

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('This backup is damaged.');
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function passphraseProblem(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 10) return 'Use at least 10 characters. A few random words work well.';
  if (passphrase.length > 256) return 'Use 256 characters or fewer.';
  if (new Set(passphrase).size < 5) return 'Use a wider mix of characters.';
  return '';
}

async function deriveKey(passphrase, salt, iterations) {
  const subtle = globalThis.crypto.subtle;
  const material = await subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable: the raw key never reaches page code
    ['encrypt', 'decrypt'],
  );
}

// A vault key is derived once per session so saving stays fast.
export async function createVaultKey(passphrase) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  return { key, salt, iterations: KDF_ITERATIONS };
}

export function isEnvelope(value) {
  return Boolean(value) && typeof value === 'object' && value.format === VAULT_FORMAT;
}

function checkEnvelope(env) {
  if (!isEnvelope(env) || env.v !== 1 || env.kdf !== 'PBKDF2-SHA256') throw new Error('This backup uses a format Constellate cannot read.');
  if (!Number.isInteger(env.iterations) || env.iterations < MIN_ITERATIONS || env.iterations > MAX_ITERATIONS) throw new Error('This backup is damaged.');
  if (typeof env.data !== 'string' || env.data.length > MAX_CIPHER_CHARS) throw new Error('This backup is damaged.');
  const salt = fromBase64(env.salt);
  const iv = fromBase64(env.iv);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new Error('This backup is damaged.');
  return { salt, iv, data: fromBase64(env.data) };
}

export async function vaultKeyFor(passphrase, envelope) {
  const parts = checkEnvelope(envelope);
  const key = await deriveKey(passphrase, parts.salt, envelope.iterations);
  return { key, salt: parts.salt, iterations: envelope.iterations };
}

export async function sealWithKey(vaultKey, plaintext) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES)); // fresh for every save
  const cipher = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD },
    vaultKey.key,
    new TextEncoder().encode(plaintext),
  );
  return {
    format: VAULT_FORMAT,
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: vaultKey.iterations,
    salt: toBase64(vaultKey.salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(cipher)),
  };
}

export async function unsealWithKey(vaultKey, envelope) {
  const parts = checkEnvelope(envelope);
  let plain;
  try {
    plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: parts.iv, additionalData: AAD }, vaultKey.key, parts.data);
  } catch {
    throw new Error('Wrong passphrase, or the data was changed.');
  }
  return new TextDecoder().decode(plain);
}

export async function seal(plaintext, passphrase) {
  return sealWithKey(await createVaultKey(passphrase), plaintext);
}

export async function unseal(envelope, passphrase) {
  return unsealWithKey(await vaultKeyFor(passphrase, envelope), envelope);
}
