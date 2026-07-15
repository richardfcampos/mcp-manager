import express, { type Express, type Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createTokenContext, type GatewayRequest, type TokenContextDeps } from './token-context.js';
import { aggregateTools, routeToolCall, type RegistryLike } from './tool-aggregator.js';

export interface GatewayRouterDeps extends TokenContextDeps {
  registry: RegistryLike;
}

const GATEWAY_SERVER_INFO = { name: 'mcp-manager-gateway', version: '0.0.0' };

/**
 * Mounts `POST /mcp/:token` (GW-01, GW-02, GW-03, SEC-02): token-context
 * middleware resolves the consumer's scope first, so an unknown/disabled
 * token returns 401 before any MCP session is built (SEC-02). On success, a
 * fresh stateless `Server` + `StreamableHTTPServerTransport` pair is built
 * per request -- matching the SDK's documented stateless pattern (see
 * `@modelcontextprotocol/sdk` examples/server/simpleStatelessStreamableHttp)
 * -- whose ListTools/CallTool handlers close over the resolved
 * `req.allowedMcpIds` and delegate to the tool-aggregator (T27), which in
 * turn resolves upstream clients through the upstream-registry (T26).
 */
export function mountGateway(app: Express, deps: GatewayRouterDeps): void {
  app.post(
    '/mcp/:token',
    express.json(),
    createTokenContext(deps),
    (req, res: Response): void => {
      void handleGatewayRequest(deps, req as GatewayRequest, res);
    },
  );
}

async function handleGatewayRequest(
  deps: GatewayRouterDeps,
  req: GatewayRequest,
  res: Response,
): Promise<void> {
  const allowedMcpIds = req.allowedMcpIds ?? [];

  const server = new Server(GATEWAY_SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await aggregateTools(deps.registry, allowedMcpIds),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await routeToolCall(
      deps.registry,
      allowedMcpIds,
      request.params.name,
      request.params.arguments,
    );
    // The upstream's CallToolResult is proxied through verbatim; routeToolCall
    // deliberately returns `unknown` since the result shape is whatever the
    // arbitrary upstream MCP server sent, so this single cast at the SDK
    // handler boundary is the only way to satisfy Server's typed return
    // contract without re-validating a shape we don't own.
    return result as Record<string, unknown>;
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: error instanceof Error ? error.message : 'internal error' },
        id: null,
      });
    }
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
