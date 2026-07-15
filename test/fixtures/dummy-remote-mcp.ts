/**
 * Minimal in-process Streamable HTTP MCP server, used by gateway
 * integration tests (upstream-client T25, upstream-registry T26,
 * gateway-router T29) as a stand-in "real" remote upstream. Binds an
 * ephemeral loopback port (never a hardcoded one) so tests can run
 * sequentially without port collisions.
 *
 * - Records every request's headers so tests can assert the gateway
 *   forwarded an injected Authorization header (GW-03).
 * - Exposes one tool, `remote-ping`.
 * - Supports `failMode`: every request is rejected with HTTP 503 to
 *   simulate an unreachable upstream, for GW-03 isolated-failure tests.
 */
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export interface DummyRemoteMcpOptions {
  /** When true, every /mcp request is rejected with 503 to simulate a
   * broken upstream (GW-03 isolation tests). */
  failMode?: boolean;
}

export interface DummyRemoteMcpHandle {
  /** Base MCP endpoint URL, e.g. http://127.0.0.1:54321/mcp */
  url: string;
  /** Headers of every request received so far, most recent last. */
  receivedHeaders: Array<Record<string, string | string[] | undefined>>;
  close: () => Promise<void>;
}

/** Starts the fixture and resolves once it is listening on an ephemeral
 * loopback port. Callers must call the returned `close()` in afterEach/
 * afterAll to release the port. */
export async function start(options: DummyRemoteMcpOptions = {}): Promise<DummyRemoteMcpHandle> {
  const receivedHeaders: DummyRemoteMcpHandle['receivedHeaders'] = [];
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    receivedHeaders.push({ ...req.headers });

    if (options.failMode) {
      res.status(503).json({ error: 'upstream unavailable (dummy-remote-mcp failMode)' });
      return;
    }

    // Stateless pattern (matches the SDK's documented
    // simpleStatelessStreamableHttp example): a fresh Server + transport
    // per request, no session state to maintain for this fixture's needs.
    const server = new Server(
      { name: 'dummy-remote-mcp', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'remote-ping',
          description: 'returns remote-pong from the remote fixture',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === 'remote-ping') {
        return { content: [{ type: 'text', text: 'remote-pong' }] };
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  const httpServer = await new Promise<HttpServer>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    receivedHeaders,
    close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
  };
}
