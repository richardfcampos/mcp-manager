import type Database from 'better-sqlite3';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpTransport } from '../domain/mcp-servers/mcp-server-types.js';
import { connectUpstream } from './upstream-client.js';
import { resolveUpstreamConfig } from './upstream-config-resolver.js';

export type UpstreamStatus = 'starting' | 'running' | 'error' | 'stopped';

/** The subset of an upstream's identity the tool-aggregator needs for
 * prefixing/routing (GW-01), sourced from the registry so the aggregator
 * never has to make its own DB/repo call. */
export interface UpstreamMeta {
  id: string;
  slug: string;
  transport: McpTransport;
}

export interface UpstreamEntry {
  mcpServer: UpstreamMeta;
  client: Client;
}

export interface UpstreamRegistryDeps {
  db: Database.Database;
  /** 32-byte AES-256-GCM master key from config/env.ts. */
  masterKey: Buffer;
}

interface CacheEntry {
  status: UpstreamStatus;
  client?: Client;
  mcpServer?: UpstreamMeta;
  error?: string;
  /** In-flight connect, shared by concurrent getClient() callers so a
   * single upstream is never connected twice at once. */
  connecting?: Promise<UpstreamEntry>;
}

/**
 * Keeps one MCP Client connected per mcpServerId (GW-02, GW-03): lazily
 * resolves config + decrypted secrets via upstream-config-resolver, connects
 * via connectUpstream, and caches the result. A failing upstream is marked
 * 'error' and its rejection is scoped to that one getClient() call -- it
 * never prevents another upstream from reaching 'running' (isolation).
 */
export class UpstreamRegistry {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly deps: UpstreamRegistryDeps) {}

  async getClient(mcpServerId: string): Promise<UpstreamEntry> {
    const existing = this.cache.get(mcpServerId);
    if (existing?.status === 'running' && existing.client && existing.mcpServer) {
      return { client: existing.client, mcpServer: existing.mcpServer };
    }
    if (existing?.connecting) {
      return existing.connecting;
    }

    const connecting = this.connect(mcpServerId);
    this.cache.set(mcpServerId, { status: 'starting', connecting });

    try {
      const entry = await connecting;
      this.cache.set(mcpServerId, {
        status: 'running',
        client: entry.client,
        mcpServer: entry.mcpServer,
      });
      return entry;
    } catch (error) {
      this.cache.set(mcpServerId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async connect(mcpServerId: string): Promise<UpstreamEntry> {
    const resolved = resolveUpstreamConfig(this.deps, mcpServerId);
    const client = await connectUpstream(resolved.mcpServer, resolved.decryptedSecretsEnv);
    return {
      client,
      mcpServer: {
        id: resolved.mcpServer.id,
        slug: resolved.mcpServer.slug,
        transport: resolved.mcpServer.transport,
      },
    };
  }

  /** 'stopped' is the default for any id never connected or previously
   * shut down. */
  status(mcpServerId: string): UpstreamStatus {
    return this.cache.get(mcpServerId)?.status ?? 'stopped';
  }

  lastError(mcpServerId: string): string | undefined {
    return this.cache.get(mcpServerId)?.error;
  }

  /** Shuts down the existing connection (if any) and lazily reconnects on
   * the next getClient() call. */
  async restart(mcpServerId: string): Promise<UpstreamEntry> {
    await this.shutdownOne(mcpServerId);
    return this.getClient(mcpServerId);
  }

  /** Closes one upstream's client, or every cached upstream when called
   * with 'all'. */
  async shutdown(mcpServerIdOrAll: string): Promise<void> {
    if (mcpServerIdOrAll === 'all') {
      await Promise.all([...this.cache.keys()].map((id) => this.shutdownOne(id)));
      return;
    }
    await this.shutdownOne(mcpServerIdOrAll);
  }

  private async shutdownOne(mcpServerId: string): Promise<void> {
    const entry = this.cache.get(mcpServerId);
    if (entry?.client) {
      try {
        await entry.client.close();
      } catch {
        // Best-effort close; the upstream process/connection may already
        // be gone.
      }
    }
    this.cache.set(mcpServerId, { status: 'stopped' });
  }
}
