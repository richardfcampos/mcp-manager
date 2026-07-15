import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** {iv,tag,ciphertext} as base64 strings -- the only at-rest shape a secret
 * value is ever allowed to take (see migrations/0001_init.sql `secret`
 * table: no plaintext/value column exists). */
export interface SealedSecret {
  iv: string;
  tag: string;
  ciphertext: string;
}

/**
 * Encrypts `plaintext` with AES-256-GCM under `key`, using a fresh random
 * 12-byte IV per call so repeated seals of the same plaintext never produce
 * matching ciphertext.
 */
export function sealSecret(plaintext: string, key: Buffer): SealedSecret {
  assertKeyLength(key);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/**
 * Decrypts a SealedSecret produced by sealSecret. GCM's authentication tag
 * makes any tampering with the ciphertext or tag, or use of the wrong key,
 * throw instead of silently returning corrupted plaintext.
 */
export function openSecret(sealed: SealedSecret, key: Buffer): string {
  assertKeyLength(key);

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Secret vault key must be exactly ${KEY_BYTES} bytes, got ${key.length}.`);
  }
}
