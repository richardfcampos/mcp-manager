import type {
  AssignmentMatrix,
  ClientFormat,
  Consumer,
  CreateMcpServerInput,
  McpServer,
  McpStatusEntry,
  McpTestResult,
  UpdateMcpServerInput,
  WriteConfigResult,
} from './api-types.js';

/** Thrown for any non-2xx `/api/*` response; carries the server's `{error}`
 * message (see src/api/error-middleware.ts) instead of a generic HTTP status
 * string, so callers can render the real validation/conflict/not-found
 * reason. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Request failed with status ${response.status}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// --- MCP servers (MCP-01/02/03, SEC-01) -------------------------------

export function listMcpServers(): Promise<McpServer[]> {
  return apiFetch('/mcp-servers');
}

export function getMcpServer(id: string): Promise<McpServer> {
  return apiFetch(`/mcp-servers/${id}`);
}

export function createMcpServer(input: CreateMcpServerInput): Promise<McpServer> {
  return apiFetch('/mcp-servers', { method: 'POST', body: JSON.stringify(input) });
}

export function updateMcpServer(id: string, input: UpdateMcpServerInput): Promise<McpServer> {
  return apiFetch(`/mcp-servers/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteMcpServer(
  id: string,
): Promise<{ deleted: boolean; configRewrites: WriteConfigResult[] }> {
  return apiFetch(`/mcp-servers/${id}`, { method: 'DELETE' });
}

// --- Consumers (PRJ-01/02/03) ------------------------------------------

export function listConsumers(): Promise<Consumer[]> {
  return apiFetch('/consumers');
}

export function discoverConsumers(): Promise<unknown> {
  return apiFetch('/consumers/discover', { method: 'POST' });
}

export function registerProjectConsumer(path: string, name?: string): Promise<Consumer> {
  return apiFetch('/consumers/project', { method: 'POST', body: JSON.stringify({ path, name }) });
}

export function registerDesktopProfileConsumer(dataDir: string, label: string): Promise<Consumer> {
  return apiFetch('/consumers/desktop-profile', {
    method: 'POST',
    body: JSON.stringify({ dataDir, label }),
  });
}

/** FMT-1/FMT-3: sets which native client config formats get written for a
 * consumer on the next write-configs run; returns the updated consumer. */
export function setConsumerFormats(id: string, clientFormats: ClientFormat[]): Promise<Consumer> {
  return apiFetch(`/consumers/${id}/formats`, {
    method: 'PUT',
    body: JSON.stringify({ clientFormats }),
  });
}

// --- Assignments (ACC-01) -----------------------------------------------

export function getAssignmentMatrix(): Promise<AssignmentMatrix> {
  return apiFetch('/assignments');
}

export function assignMcp(consumerId: string, mcpServerId: string): Promise<unknown> {
  return apiFetch('/assignments', {
    method: 'POST',
    body: JSON.stringify({ consumerId, mcpServerId }),
  });
}

export function unassignMcp(consumerId: string, mcpServerId: string): Promise<unknown> {
  return apiFetch('/assignments', {
    method: 'DELETE',
    body: JSON.stringify({ consumerId, mcpServerId }),
  });
}

// --- Actions (CFG-01/02, status, preview) --------------------------------

export function writeConfigs(consumerIds?: string[]): Promise<{ results: WriteConfigResult[] }> {
  return apiFetch('/actions/write-configs', { method: 'POST', body: JSON.stringify({ consumerIds }) });
}

export function rotateToken(
  consumerId: string,
): Promise<{ consumerId: string; token: string; configRewrites: WriteConfigResult[] }> {
  return apiFetch('/actions/rotate-token', { method: 'POST', body: JSON.stringify({ consumerId }) });
}

export function getMcpStatus(): Promise<{ statuses: McpStatusEntry[] }> {
  return apiFetch('/actions/status');
}

/** Forces the lazy upstream to connect NOW and reports the outcome --
 * "is this MCP actually working?" as a button. */
export function testMcp(mcpId: string): Promise<McpTestResult> {
  return apiFetch('/actions/test-mcp', { method: 'POST', body: JSON.stringify({ mcpId }) });
}

/** Returns the raw config-file content that a write-configs call WOULD
 * produce for this consumer (no file is written -- see GET /api/actions/preview). */
export async function previewConfig(consumerId: string): Promise<string> {
  const response = await fetch(`/api/actions/preview?consumerId=${encodeURIComponent(consumerId)}`);
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.text();
}
