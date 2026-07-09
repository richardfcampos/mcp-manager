import type { ManagedEntry } from './writer-interface.js';

/**
 * Stable key identifying our single aggregated gateway entry inside a
 * client's `mcpServers` map. One key regardless of how many MCPs are
 * assigned to the consumer -- the gateway itself aggregates them behind one
 * URL, so we never write one entry per MCP.
 */
export const MANAGED_KEY = 'mcp-manager-gateway';

/** The parsed `mcpServers` map of a native client config file. */
export type McpServersMap = Record<string, unknown>;

/**
 * Upserts `managedEntries` into `existingServers`, leaving every
 * non-managed (user-authored) key untouched. Returns a NEW map with keys in
 * deterministic (sorted) order so repeated merges of logically-identical
 * content serialize to byte-identical JSON -- the property idempotent
 * writes depend on (CFG-02).
 */
export function mergeManagedEntries(
  existingServers: McpServersMap,
  managedEntries: Record<string, ManagedEntry>,
): McpServersMap {
  return sortedMap({ ...existingServers, ...managedEntries });
}

/**
 * Removes every key in `managedKeys` from `existingServers`, preserving all
 * other (user) entries untouched. Used when a consumer is left with 0
 * assignments and its managed entry must be cleaned up (CFG-02).
 */
export function removeManagedEntries(
  existingServers: McpServersMap,
  managedKeys: string[],
): McpServersMap {
  const remaining: McpServersMap = {};
  for (const key of Object.keys(existingServers)) {
    if (!managedKeys.includes(key)) {
      remaining[key] = existingServers[key];
    }
  }
  return sortedMap(remaining);
}

/** Rebuilds `map` with its keys inserted in sorted order, so `JSON.stringify`
 * output is stable regardless of the insertion order of the inputs. */
function sortedMap(map: McpServersMap): McpServersMap {
  const sorted: McpServersMap = {};
  for (const key of Object.keys(map).sort()) {
    sorted[key] = map[key];
  }
  return sorted;
}
