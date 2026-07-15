import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret, type SealedSecret } from './secret-vault.js';

const key = randomBytes(32);

describe('secret-vault', () => {
  it('round-trips: openSecret(sealSecret(p)) === p', () => {
    const plaintext = 'super-secret-token-value';

    const sealed = sealSecret(plaintext, key);

    expect(openSecret(sealed, key)).toBe(plaintext);
  });

  it('never stores the plaintext value as the ciphertext (encrypted at rest)', () => {
    const plaintext = 'super-secret-token-value';

    const sealed = sealSecret(plaintext, key);

    expect(sealed.ciphertext).not.toBe(plaintext);
    expect(Buffer.from(sealed.ciphertext, 'base64').toString('utf8')).not.toBe(plaintext);
  });

  it('produces a different iv and ciphertext for two seals of identical plaintext', () => {
    const plaintext = 'super-secret-token-value';

    const first = sealSecret(plaintext, key);
    const second = sealSecret(plaintext, key);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('throws when a ciphertext byte is mutated (tamper detection)', () => {
    const sealed = sealSecret('super-secret-token-value', key);
    const tamperedBytes = Buffer.from(sealed.ciphertext, 'base64');
    tamperedBytes[0] = tamperedBytes[0] ^ 0xff;
    const tampered: SealedSecret = { ...sealed, ciphertext: tamperedBytes.toString('base64') };

    expect(() => openSecret(tampered, key)).toThrow();
  });

  it('throws when the auth tag is mutated (tamper detection)', () => {
    const sealed = sealSecret('super-secret-token-value', key);
    const tamperedTag = Buffer.from(sealed.tag, 'base64');
    tamperedTag[0] = tamperedTag[0] ^ 0xff;
    const tampered: SealedSecret = { ...sealed, tag: tamperedTag.toString('base64') };

    expect(() => openSecret(tampered, key)).toThrow();
  });

  it('throws when opened under a wrong 32-byte key', () => {
    const sealed = sealSecret('super-secret-token-value', key);
    const wrongKey = randomBytes(32);

    expect(() => openSecret(sealed, wrongKey)).toThrow();
  });

  it('throws from both sealSecret and openSecret for a non-32-byte key', () => {
    const shortKey = randomBytes(16);
    const sealed = sealSecret('placeholder', key);

    expect(() => sealSecret('placeholder', shortKey)).toThrow();
    expect(() => openSecret(sealed, shortKey)).toThrow();
  });
});
