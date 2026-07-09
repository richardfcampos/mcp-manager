import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildProductionServer, type ProductionServer } from '../../src/server.js';

const FIXTURE_STDIO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/dummy-stdio-mcp.ts',
);

function buildTestEnv(): NodeJS.ProcessEnv {
  return {
    MCP_MANAGER_MASTER_KEY: randomBytes(32).toString('base64'),
    MCP_MANAGER_WORKSPACE_ROOT: mkdtempSync(join(tmpdir(), 'mcp-manager-server-assembly-')),
    MCP_MANAGER_DB_PATH: ':memory:',
  };
}

/**
 * T56: proves server.ts's buildProductionServer assembles ONE Express app
 * (not the test-only harness in helpers/build-test-app.ts) that serves the
 * REST API, the gateway, and the healthcheck together -- the real
 * single-process production path (GW-01, SEC-02).
 */
describe('server-assembly: buildProductionServer serves api + gateway on one process', () => {
  let productionServer: ProductionServer | undefined;
  let httpServer: HttpServer | undefined;

  afterEach(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      httpServer = undefined;
    }
    await productionServer?.close();
    productionServer = undefined;
  });

  it('GET /healthz -> 200, GET /api/health -> 200 (api mounted), POST /mcp/:token unknown token -> 401 (gateway mounted, SEC-02)', async () => {
    productionServer = buildProductionServer(buildTestEnv());

    const healthzResponse = await request(productionServer.app).get('/healthz');
    expect(healthzResponse.status).toBe(200);

    const apiHealthResponse = await request(productionServer.app).get('/api/health');
    expect(apiHealthResponse.status).toBe(200);

    const gatewayResponse = await request(productionServer.app)
      .post('/mcp/no-such-token')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(gatewayResponse.status).toBe(401);
  });

  it('GW-01 end-to-end on one process: create MCP via /api, register a project, assign it, then an MCP client over /mcp/:token lists only that consumer\'s prefixed tool', async () => {
    const env = buildTestEnv();
    productionServer = buildProductionServer(env);

    httpServer = await new Promise<HttpServer>((resolve) => {
      const listening = productionServer!.app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const createResponse = await fetch(`${baseUrl}/api/mcp-servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e-stdio-mcp',
        kind: 'stdio',
        command: process.execPath,
        args: [FIXTURE_STDIO_PATH],
      }),
    });
    expect(createResponse.status).toBe(201);
    const mcpServer = (await createResponse.json()) as { id: string };

    const registerResponse = await fetch(`${baseUrl}/api/consumers/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: env.MCP_MANAGER_WORKSPACE_ROOT, name: 'e2e-project' }),
    });
    expect(registerResponse.status).toBe(201);
    const consumer = (await registerResponse.json()) as { id: string; token: string };

    const assignResponse = await fetch(`${baseUrl}/api/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consumerId: consumer.id, mcpServerId: mcpServer.id }),
    });
    expect(assignResponse.status).toBe(201);

    const client = new Client({ name: 'server-assembly-test-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/${consumer.token}`)));
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'e2e-stdio-mcp__echo',
      'e2e-stdio-mcp__ping',
      'e2e-stdio-mcp__read-secret',
    ]);
  });
});
