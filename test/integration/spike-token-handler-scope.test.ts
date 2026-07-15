import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * SPIKE (T22): resolves the design's transport-timing risk -- can the
 * `:token` from `POST /mcp/:token` be read inside the per-session MCP
 * Server's ListTools/CallTool handler scope?
 *
 * RESULT: YES. Express resolves `req.params.token` before any route
 * handler runs, so the token is available synchronously the moment the
 * POST handler starts executing -- well before the per-request Server and
 * StreamableHTTPServerTransport are even constructed. The chosen approach:
 * capture `req.params.token` into a local `const` at the top of the route
 * handler, then close over that const in the ListTools/CallTool handlers
 * registered on the per-request Server. No middleware-to-transport timing
 * race exists because everything happens synchronously in one handler
 * before `transport.handleRequest()` is ever awaited.
 *
 * This is the pattern gateway-router.ts (T29) and token-context.ts (T28)
 * build on: resolve token -> consumer -> allowed scope in Express
 * middleware (which also runs before the transport), then construct a
 * fresh per-request Server whose handlers close over that resolved scope.
 */
describe('spike: token readable in per-session MCP handler scope', () => {
  let httpServer: HttpServer | undefined;

  afterEach(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
      httpServer = undefined;
    }
  });

  it('exposes req.params.token to the ListTools handler via a closure captured before transport handling', async () => {
    const app = express();
    app.use(express.json());

    app.post('/mcp/:token', async (req, res) => {
      // Captured here, in the route handler, BEFORE the per-session
      // Server/transport are built -- proves the token is readable in
      // handler scope (see spike result note above).
      const token = req.params.token;

      const server = new Server(
        { name: 'spike-server', version: '0.0.0' },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: token,
            description: 'echoes the token resolved in the route handler closure',
            inputSchema: { type: 'object' as const, properties: {} },
          },
        ],
      }));

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } finally {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      }
    });

    httpServer = await new Promise<HttpServer>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const { port } = httpServer.address() as AddressInfo;

    const knownToken = `tok-${randomUUID()}`;
    const client = new Client({ name: 'spike-client', version: '0.0.0' });
    const clientTransport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp/${knownToken}`),
    );
    await client.connect(clientTransport);

    const { tools } = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe(knownToken);

    await client.close();
  });
});
