import type Database from 'better-sqlite3';
import * as mcpServersRepository from '../domain/mcp-servers/mcp-servers-repository.js';
import type { McpServerListItem } from '../domain/mcp-servers/mcp-server-types.js';
import { openSecret } from '../vault/secret-vault.js';

export interface UpstreamConfigResolverDeps {
  db: Database.Database;
  /** 32-byte AES-256-GCM master key from config/env.ts. */
  masterKey: Buffer;
}

export interface ResolvedUpstreamConfig {
  mcpServer: McpServerListItem;
  /** envKey -> plaintext, decrypted in-memory only from the server's sealed
   * secret rows -- ready to hand to connectUpstream (GW-02). Never logged
   * or persisted. */
  decryptedSecretsEnv: Record<string, string>;
}

/**
 * Loads an MCP server's metadata plus its sealed secret rows and decrypts
 * each one via the vault, producing the config connectUpstream needs to
 * open the connection (GW-02 secret injection source, used by the
 * upstream-registry T26). Throws when `mcpServerId` has no server row. A
 * server with zero sealed secrets resolves to an empty map, not an error.
 */
export function resolveUpstreamConfig(
  deps: UpstreamConfigResolverDeps,
  mcpServerId: string,
): ResolvedUpstreamConfig {
  const mcpServer = mcpServersRepository.getServer(deps.db, mcpServerId);
  if (!mcpServer) {
    throw new Error(`No MCP server found with id: ${mcpServerId}`);
  }

  const decryptedSecretsEnv: Record<string, string> = {};
  for (const sealed of mcpServersRepository.listSealedSecrets(deps.db, mcpServerId)) {
    decryptedSecretsEnv[sealed.envKey] = openSecret(sealed, deps.masterKey);
  }

  return { mcpServer, decryptedSecretsEnv };
}
