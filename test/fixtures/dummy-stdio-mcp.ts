#!/usr/bin/env node
/**
 * Minimal runnable MCP server over stdio, used by gateway integration tests
 * (upstream-client T25, upstream-registry T26, gateway-router T29) as a
 * stand-in "real" stdio upstream. Launched as a child process via
 * `node <this file>` (Node's native TypeScript support strips the types --
 * no build step required for this fixture).
 *
 * Tools:
 *  - `ping`: returns the literal text "pong"
 *  - `echo`: echoes back `arguments.text`
 *  - `read-secret`: returns the FIXTURE_SECRET env var value, proving a
 *    decrypted secret injected by connectUpstream reaches the spawned
 *    child's environment (GW-02).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const EMPTY_OBJECT_SCHEMA = { type: 'object' as const, properties: {} };

/**
 * Announced via the initialize response so the gateway's list_mcps fallback
 * (DESC-02) has an upstream description to derive when a MCP has no manually
 * authored `purpose`. Deliberately longer than the discovery-tools 400-char
 * truncation cap so integration tests can assert list_mcps truncates a
 * verbose upstream instead of re-flooding the caller's context.
 */
const FIXTURE_INSTRUCTIONS =
  'FIXTURE_INSTRUCTIONS: This dummy stdio MCP is a gateway integration-test fixture. ' +
  'It advertises three tools -- ping (returns "pong"), echo (returns arguments.text) and ' +
  'read-secret (returns the FIXTURE_SECRET env var). These instructions exist only so the ' +
  'discovery list_mcps fallback has something to announce, and they are intentionally padded ' +
  'well beyond four hundred characters so the truncation limit is exercised end to end: ' +
  'padding padding padding padding padding padding padding padding padding padding padding.';

async function main(): Promise<void> {
  const server = new Server(
    { name: 'dummy-stdio-mcp', version: '0.0.0' },
    { capabilities: { tools: {} }, instructions: FIXTURE_INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'ping', description: 'returns pong', inputSchema: EMPTY_OBJECT_SCHEMA },
      {
        name: 'echo',
        description: 'echoes arguments.text back',
        inputSchema: {
          type: 'object' as const,
          properties: { text: { type: 'string' } },
        },
      },
      {
        name: 'read-secret',
        description: 'returns the FIXTURE_SECRET env var value',
        inputSchema: EMPTY_OBJECT_SCHEMA,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'ping') {
      return { content: [{ type: 'text', text: 'pong' }] };
    }
    if (name === 'echo') {
      const text = typeof args?.text === 'string' ? args.text : '';
      return { content: [{ type: 'text', text }] };
    }
    if (name === 'read-secret') {
      return { content: [{ type: 'text', text: process.env.FIXTURE_SECRET ?? '' }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error('dummy-stdio-mcp fatal error:', error);
  process.exitCode = 1;
});
