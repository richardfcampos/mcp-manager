import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConsumerRecord } from '../domain/consumers/consumer-types.js';
import { MANAGED_KEY, mergeManagedEntries, removeManagedEntries } from './managed-block.js';
import type { McpServersMap } from './managed-block.js';
import type { ConfigWriter, ManagedEntry } from './writer-interface.js';

/** The shape of a Claude Code `.mcp.json` file: `mcpServers` plus whatever
 * other top-level keys the user's file already has, all preserved as-is. */
interface McpJsonFile {
  mcpServers?: McpServersMap;
  [key: string]: unknown;
}

function configPath(consumer: ConsumerRecord): string {
  return join(consumer.path, '.mcp.json');
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
 * CFG-01/CFG-02: writes a single managed `mcp-manager-gateway` entry
 * (type:http, url=`<gatewayBaseUrl>/mcp/<token>`, bearer auth header) into
 * the project's `.mcp.json`, preserving every other entry the user already
 * has. `hasAssignments=false` removes the managed entry instead (cleanup).
 * Idempotent: skips the actual filesystem write when the serialized content
 * is unchanged from what's on disk. Never throws -- IO/parse failures
 * resolve to status:'error' with the message, so one project's failure
 * never aborts a batch of writes.
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
    const existingServers = existing.mcpServers ?? {};

    const entry: ManagedEntry = {
      type: 'http',
      url: `${gatewayBaseUrl}/mcp/${consumer.token}`,
      headers: { Authorization: `Bearer ${consumer.token}` },
    };

    const mcpServers = hasAssignments
      ? mergeManagedEntries(existingServers, { [MANAGED_KEY]: entry })
      : removeManagedEntries(existingServers, [MANAGED_KEY]);

    const nextContent = serialize({ ...existing, mcpServers });

    if (currentContent === nextContent) {
      return { consumerId: consumer.id, format: 'claude-code', path, status: 'unchanged' };
    }

    writeFileSync(path, nextContent, 'utf-8');
    return {
      consumerId: consumer.id,
      format: 'claude-code',
      path,
      status: hasAssignments ? 'written' : 'removed',
    };
  } catch (err) {
    return {
      consumerId: consumer.id,
      format: 'claude-code',
      path,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
