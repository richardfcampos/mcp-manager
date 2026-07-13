import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { ConsumerRecord } from '../domain/consumers/consumer-types.js';
import { MANAGED_KEY, mergeManagedEntries, removeManagedEntries } from './managed-block.js';
import type { McpServersMap } from './managed-block.js';
import type { ConfigWriter } from './writer-interface.js';

/** Shape of a Codex `config.toml`: `mcp_servers` (TOML tables keyed by
 * server name) plus any other top-level Codex settings the user's file
 * already has, all preserved. Codex reads project-scoped `.codex/config.toml`
 * for trusted projects. */
interface CodexConfig {
  mcp_servers?: McpServersMap;
  [key: string]: unknown;
}

/** Codex streamable-HTTP server entry: presence of `url` selects the HTTP
 * transport; the per-consumer bearer token rides the URL path (the gateway's
 * actual auth) and an explicit `http_headers` Authorization for parity with
 * the JSON writers. */
interface CodexEntry {
  url: string;
  http_headers: Record<string, string>;
}

function configDir(consumer: ConsumerRecord): string {
  return join(consumer.path, '.codex');
}

function configPath(consumer: ConsumerRecord): string {
  return join(configDir(consumer), 'config.toml');
}

function readRaw(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
}

function parseExisting(raw: string | undefined): CodexConfig {
  if (!raw || !raw.trim()) {
    return {};
  }
  return parseToml(raw) as CodexConfig;
}

function serialize(config: CodexConfig): string {
  return `${stringifyToml(config)}\n`;
}

/**
 * Writes a single managed `mcp-manager-gateway` server table into the
 * project's `.codex/config.toml` under `mcp_servers`, preserving every other
 * server table and top-level Codex setting. Creates the `.codex` directory
 * when absent. `hasAssignments=false` removes the managed entry (cleanup),
 * and cleanup is a no-op when there is nothing to clean (never creates a stub
 * or reformats a file that lacks our entry). Idempotent: skips the write when
 * the serialized content is unchanged. Never throws -- IO/parse failures
 * resolve to status:'error'.
 */
export const writeConfig: ConfigWriter['writeConfig'] = async (
  consumer,
  gatewayBaseUrl,
  hasAssignments,
) => {
  const path = configPath(consumer);

  try {
    const currentContent = readRaw(path);
    const existing = parseExisting(currentContent);
    const existingServers = existing.mcp_servers ?? {};

    if (!hasAssignments && (currentContent === undefined || !(MANAGED_KEY in existingServers))) {
      return { consumerId: consumer.id, format: 'codex', path, status: 'unchanged' };
    }

    const entry: CodexEntry = {
      url: `${gatewayBaseUrl}/mcp/${consumer.token}`,
      http_headers: { Authorization: `Bearer ${consumer.token}` },
    };

    const mcpServers = hasAssignments
      ? mergeManagedEntries(existingServers, { [MANAGED_KEY]: entry })
      : removeManagedEntries(existingServers, [MANAGED_KEY]);

    const nextContent = serialize({ ...existing, mcp_servers: mcpServers });

    if (currentContent === nextContent) {
      return { consumerId: consumer.id, format: 'codex', path, status: 'unchanged' };
    }

    mkdirSync(configDir(consumer), { recursive: true });
    writeFileSync(path, nextContent, 'utf-8');
    return {
      consumerId: consumer.id,
      format: 'codex',
      path,
      status: hasAssignments ? 'written' : 'removed',
    };
  } catch (err) {
    return {
      consumerId: consumer.id,
      format: 'codex',
      path,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
