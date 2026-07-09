/** A consumer is either a project folder (receives a written client config)
 * or a Claude Desktop profile (receives an `mcpServers` shim block). */
export type ConsumerType = 'project' | 'desktop-profile';

/** Native client config formats a `project` consumer can be written for.
 * Only meaningful when type === 'project'. */
export type ClientFormat = 'claude-code' | 'cursor' | 'vscode';

export interface ConsumerRecord {
  id: string;
  type: ConsumerType;
  name: string;
  path: string;
  token: string;
  clientFormats: ClientFormat[];
  /** true when auto-discovered from the workspace root, false when manually registered. */
  discovered: boolean;
  /** false when a previously-discovered folder has vanished from disk. */
  available: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface InsertConsumerInput {
  id: string;
  type: ConsumerType;
  name: string;
  path: string;
  token: string;
  clientFormats?: ClientFormat[];
  discovered?: boolean;
  available?: boolean;
  enabled?: boolean;
  createdAt: string;
}

/** Input for upsertDiscovered -- always a discovered `project` consumer;
 * idempotent by path (a repeat call with the same path returns the existing
 * row unchanged rather than inserting a duplicate). */
export interface UpsertDiscoveredInput {
  path: string;
  name: string;
  createdAt: string;
}
