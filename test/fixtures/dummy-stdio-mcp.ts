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

async function main(): Promise<void> {
  const server = new Server(
    { name: 'dummy-stdio-mcp', version: '0.0.0' },
    { capabilities: { tools: {} } },
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
