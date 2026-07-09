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
  secrets: SealedSecretInput[];
}

/** Partial update; when `secrets` is provided the entire secret row set for
 * the server is replaced (old rows removed, new rows inserted). */
export interface UpdateServerInput {
  name?: string;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  secrets?: SealedSecretInput[];
}
