import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConsumerRecord } from '../domain/consumers/consumer-types.js';
import { MANAGED_KEY, mergeManagedEntries, removeManagedEntries } from './managed-block.js';
import type { McpServersMap } from './managed-block.js';
import type { ConfigWriter, ManagedEntry } from './writer-interface.js';

/** The shape of a VS Code `.vscode/mcp.json` file: `servers` (NOT
 * `mcpServers`) plus whatever other top-level keys the user's file already
 * has (e.g. `inputs`, `sandbox`), all preserved as-is. */
interface McpJsonFile {
  servers?: McpServersMap;
  [key: string]: unknown;
}

function configDir(consumer: ConsumerRecord): string {
  return join(consumer.path, '.vscode');
}

function configPath(consumer: ConsumerRecord): string {
  return join(configDir(consumer), 'mcp.json');
}

/** Returns the raw file content, or undefined when the file doesn't exist
 * yet -- kept separate from parsing so idempotency can compare against the
 * exact on-disk bytes. */
function readRaw(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
}

function parseExisting(raw: string | undefined): McpJsonFile {
  if (!raw || !raw.trim()) {
    return {};
  }
  return JSON.parse(raw) as McpJsonFile;
}

function serialize(config: McpJsonFile): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * CFG-V1..V2: writes a single managed `mcp-manager-gateway` entry
 * (type:http, url=`<gatewayBaseUrl>/mcp/<token>`, bearer auth header) into
 * the project's `.vscode/mcp.json` under the top-level `servers` key,
 * preserving every other entry (including unrelated top-level keys like
 * `inputs`/`sandbox`) the user already has. Creates the `.vscode` directory
 * when it doesn't exist yet. `hasAssignments=false` removes the managed
 * entry instead (cleanup). Idempotent: skips the actual filesystem write
 * when the serialized content is unchanged from what's on disk. Never
 * throws -- IO/parse failures resolve to status:'error' with the message,
 * so one project's failure never aborts a batch of writes.
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
    const existingServers = existing.servers ?? {};

    const entry: ManagedEntry = {
      type: 'http',
      url: `${gatewayBaseUrl}/mcp/${consumer.token}`,
      headers: { Authorization: `Bearer ${consumer.token}` },
    };

    const servers = hasAssignments
      ? mergeManagedEntries(existingServers, { [MANAGED_KEY]: entry })
      : removeManagedEntries(existingServers, [MANAGED_KEY]);

    const nextContent = serialize({ ...existing, servers });

    if (currentContent === nextContent) {
      return { consumerId: consumer.id, format: 'vscode', path, status: 'unchanged' };
    }

    mkdirSync(configDir(consumer), { recursive: true });
    writeFileSync(path, nextContent, 'utf-8');
    return {
      consumerId: consumer.id,
      format: 'vscode',
      path,
      status: hasAssignments ? 'written' : 'removed',
    };
  } catch (err) {
    return {
      consumerId: consumer.id,
      format: 'vscode',
      path,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
