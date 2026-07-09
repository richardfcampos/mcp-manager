import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpTransport } from '../domain/mcp-servers/mcp-server-types.js';

/** The subset of an McpServer row connectUpstream needs to open one
 * connection -- kept narrow so callers (upstream-registry, tests) don't
 * need a full repository read shape. */
export interface UpstreamConnectConfig {
  transport: McpTransport;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  headers?: Record<string, string> | null;
}

const DEFAULT_CLIENT_INFO = { name: 'mcp-manager-gateway', version: '0.0.0' };

/**
 * Connects one MCP Client to an upstream server (GW-02, GW-03):
 *  - stdio: spawns `command`/`args` as a child process via
 *    StdioClientTransport, with `decryptedSecrets` passed as `env`. The SDK
 *    merges this with its own safe default-inherited environment (PATH,
 *    HOME, etc.), so callers only need to supply the secret values -- not a
 *    full environment (GW-02 secret injection).
 *  - http/sse: connects via StreamableHTTPClientTransport to `url`, sending
 *    any static `headers` plus `decryptedSecrets` merged in as additional
 *    request headers (e.g. an `Authorization` secret becomes the
 *    Authorization header) -- GW-03 remote proxy.
 *
 * Throws when the upstream is unreachable or misconfigured. Callers
 * (upstream-registry) are responsible for catching this per-mcpId so one
 * failing upstream never affects another (GW-03 isolation).
 */
export async function connectUpstream(
  mcpServer: UpstreamConnectConfig,
  decryptedSecrets: Record<string, string>,
  clientInfo: { name: string; version: string } = DEFAULT_CLIENT_INFO,
): Promise<Client> {
  const client = new Client(clientInfo);

  if (mcpServer.transport === 'stdio') {
    if (!mcpServer.command) {
      throw new Error('stdio upstream is missing a command');
    }
    const transport = new StdioClientTransport({
      command: mcpServer.command,
      args: mcpServer.args ?? [],
      env: decryptedSecrets,
    });
    await client.connect(transport);
    return client;
  }

  if (!mcpServer.url) {
    throw new Error(`${mcpServer.transport} upstream is missing a url`);
  }
  const transport = new StreamableHTTPClientTransport(new URL(mcpServer.url), {
    requestInit: {
      headers: { ...(mcpServer.headers ?? {}), ...decryptedSecrets },
    },
  });
  await client.connect(transport);
  return client;
}
