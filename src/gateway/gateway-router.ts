import express, { type Express, type Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createTokenContext, type GatewayRequest, type TokenContextDeps } from './token-context.js';
import { listScopedByIds } from '../domain/mcp-servers/mcp-servers-repository.js';
import {
  DISCOVERY_TOOL_DEFINITIONS,
  handleDiscoveryToolCall,
  type DiscoveryToolDeps,
  type RegistryLike,
} from './discovery-tools.js';

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
 * -- whose ListTools handler returns the 3 fixed discovery meta-tools
 * (never flattened upstream tools) and whose CallTool handler closes over
 * the resolved `req.allowedMcpIds` and delegates to the discovery-tools
 * dispatcher, which resolves scoped MCPs from the DB and reaches upstream
 * clients through the upstream-registry.
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

  // `listScopedMcps` is bound to this app's db so discovery reads only the
  // sanitized {id, slug, name, purpose} projection (never secrets/command --
  // SEC-10); the registry is the shared lazy-connect upstream pool.
  const discoveryDeps: DiscoveryToolDeps = {
    registry: deps.registry,
    listScopedMcps: (ids) => listScopedByIds(deps.db, ids),
  };

  const server = new Server(GATEWAY_SERVER_INFO, { capabilities: { tools: {} } });

  // DISC-01: always exactly the 3 meta-tools, regardless of how many MCPs the
  // consumer is assigned -- no upstream tools are flattened into this list.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: DISCOVERY_TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await handleDiscoveryToolCall(
      discoveryDeps,
      allowedMcpIds,
      request.params.name,
      request.params.arguments,
    );
    // A meta-tool result, or an upstream's CallToolResult proxied verbatim by
    // call_mcp_tool. handleDiscoveryToolCall returns `unknown` because the
    // proxied shape is whatever the arbitrary upstream sent, so this single
    // cast at the SDK handler boundary satisfies Server's typed return
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
