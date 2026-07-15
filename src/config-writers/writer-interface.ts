import type { ClientFormat, ConsumerRecord } from '../domain/consumers/consumer-types.js';

/**
 * A single managed `mcpServers` entry written by a ConfigWriter -- the shape
 * every native client format writes for our gateway: a remote HTTP
 * transport carrying the consumer's own bearer token. The gateway
 * aggregates ALL of a consumer's assigned MCPs behind one URL, so a
 * consumer only ever gets ONE ManagedEntry, never one per assigned MCP.
 */
export interface ManagedEntry {
  type: 'http';
  url: string;
  headers: Record<string, string>;
}

export type WriteConfigStatus = 'written' | 'unchanged' | 'removed' | 'error';

export interface WriteConfigResult {
  consumerId: string;
  format: ClientFormat;
  path: string;
  status: WriteConfigStatus;
  /** Present only when status === 'error'. */
  error?: string;
}

/**
 * Contract every native-client config writer implements (claude-code today;
 * cursor/vscode/desktop are P2 additions of the same shape).
 *
 * `gatewayBaseUrl` is always passed in as a parameter -- writers never read
 * it from env themselves -- so they stay pure functions of their inputs and
 * are trivially unit-testable against a temp directory.
 *
 * `hasAssignments` tells the writer whether to upsert (true) or clean up
 * (false) its single managed entry; it never throws on IO/parse failure,
 * always resolving to a WriteConfigResult with status:'error' instead.
 */
export interface ConfigWriter {
  writeConfig(
    consumer: ConsumerRecord,
    gatewayBaseUrl: string,
    hasAssignments: boolean,
  ): Promise<WriteConfigResult>;
}
