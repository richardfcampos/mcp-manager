/** Transport family a registered MCP server connects over. */
export type McpTransport = 'stdio' | 'http' | 'sse';

/** A sealed (already-encrypted) secret env value ready to persist as-is --
 * callers of the repository never pass plaintext through this shape. */
export interface SealedSecretInput {
  envKey: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

/** Raw sealed secret row as stored, keyed by envKey -- returned only by
 * listSealedSecrets for the future gateway resolver's decrypt path, never
 * by getServer/listServers (SEC-01: read never returns plaintext/ciphertext). */
export interface SealedSecretRow extends SealedSecretInput {
  id: string;
  mcpServerId: string;
}

/** Per-envKey exposure of whether a secret is set, with no ciphertext or
 * plaintext attached -- the only secret-related shape getServer/listServers
 * may ever return. */
export interface SecretPresenceFlag {
  envKey: string;
  hasValue: boolean;
}

/** Server metadata + secret presence flags -- the sanitized read shape used
 * by getServer and listServers. */
export interface McpServerListItem {
  id: string;
  slug: string;
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[] | null;
  url: string | null;
  headers: Record<string, string> | null;
  createdAt: string;
  /** Human-authored "what this is for" text, read by the gateway's
   * list_mcps discovery tool when set (DESC-01). */
  purpose: string | null;
  secrets: SecretPresenceFlag[];
}

/** Bare server row without secret presence flags -- used by findByName for
 * existence checks that don't need to touch the secret table. */
export interface McpServerRecord {
  id: string;
  slug: string;
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[] | null;
  url: string | null;
  headers: Record<string, string> | null;
  createdAt: string;
  purpose: string | null;
}

export interface InsertServerInput {
  id: string;
  slug: string;
  name: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  createdAt: string;
  /** Optional like the other metadata fields above: omitted persists null. */
  purpose?: string | null;
  secrets: SealedSecretInput[];
}

/** Partial update. Secrets are per-key operations: `removeSecretKeys`
 * deletes those rows, then `secrets` upserts by env_key -- untouched keys
 * keep their sealed values. */
export interface UpdateServerInput {
  name?: string;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  /** undefined leaves purpose untouched; null clears it (DESC-01). */
  purpose?: string | null;
  secrets?: SealedSecretInput[];
  removeSecretKeys?: string[];
}

/** Sanitized, scoped read used by the gateway's discovery tools -- never
 * command/args/url/headers/secrets (SEC-10). */
export interface ScopedMcp {
  id: string;
  slug: string;
  name: string;
  purpose: string | null;
}
