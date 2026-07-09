import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

/** Generates a fresh base64url bearer token for a consumer's gateway URL
 * (`/mcp/<token>`). Used for both initial registration and rotation. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}
