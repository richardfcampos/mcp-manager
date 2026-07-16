/**
 * Response/request shapes for `/api/*`, kept in lockstep with the server-side
 * types (see src/domain/*, src/config-writers/writer-interface.ts,
 * src/gateway/upstream-registry.ts) but declared independently here since the
 * web SPA compiles under its own tsconfig (web/tsconfig.json) and never
 * imports server-side source directly.
 */

export type McpTransport = 'stdio' | 'http' | 'sse';

export interface SecretPresenceFlag {
  envKey: string;
  hasValue: boolean;
}

/** Sanitized MCP server shape returned by every read endpoint -- secrets are
 * always `{envKey, hasValue}`, never plaintext or ciphertext (SEC-01). */
export interface McpServer {
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

export interface McpServerSecretInput {
  envKey: string;
  value: string;
}

export interface CreateMcpServerInput {
  name: string;
  kind: 'stdio' | 'remote';
  command?: string;
  args?: string[];
  url?: string;
  sse?: boolean;
  headers?: Record<string, string>;
  /** Human-authored "what this is for" text, read by the gateway's
   * list_mcps discovery tool (DESC-01); trimmed, max 2000 chars server-side. */
  purpose?: string;
  secrets?: McpServerSecretInput[];
}

export interface UpdateMcpServerInput {
  name?: string;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  /** undefined leaves purpose untouched; null clears it (DESC-01). */
  purpose?: string | null;
  /** Upserted by envKey; untouched keys keep their stored values. */
  secrets?: McpServerSecretInput[];
  /** Env keys whose stored secrets are deleted (applied before upserts). */
  removeSecretKeys?: string[];
}

export type ConsumerType = 'project' | 'desktop-profile';
export type ClientFormat = 'claude-code' | 'cursor' | 'vscode' | 'codex';

export interface Consumer {
  id: string;
  type: ConsumerType;
  name: string;
  path: string;
  token: string;
  clientFormats: ClientFormat[];
  discovered: boolean;
  available: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface AssignmentMatrix {
  consumers: Array<{ consumerId: string; allowedMcpIds: string[] }>;
  mcpServers: Array<{ mcpServerId: string; consumerIds: string[] }>;
}

export type WriteConfigStatus = 'written' | 'unchanged' | 'removed' | 'error';

export interface WriteConfigResult {
  consumerId: string;
  format: ClientFormat;
  path: string;
  status: WriteConfigStatus;
  error?: string;
}

export type UpstreamStatus = 'starting' | 'running' | 'error' | 'stopped';

export interface McpStatusEntry {
  mcpId: string;
  slug: string;
  status: UpstreamStatus;
  /** Present when status === 'error': the last connection failure reason. */
  error?: string;
}

/** Outcome of POST /api/actions/test-mcp (an on-demand connect). */
export interface McpTestResult {
  mcpId: string;
  slug: string;
  status: 'running' | 'error';
  error?: string;
}
