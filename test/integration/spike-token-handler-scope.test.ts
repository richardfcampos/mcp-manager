import { dirname, join } from 'node:path';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generateId, nowIso } from '../../src/db/repository-helpers.js';
import * as assignmentsRepository from '../../src/domain/assignments/assignments-repository.js';
import * as consumersRepository from '../../src/domain/consumers/consumers-repository.js';
import * as mcpServersRepository from '../../src/domain/mcp-servers/mcp-servers-repository.js';
import { mountGateway } from '../../src/gateway/gateway-router.js';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

const FIXTURE_STDIO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/dummy-stdio-mcp.ts',
);

/**
 * Originally a T22 spike proving `req.params.token` is readable inside the
 * per-request MCP Server's handler scope (Express resolves route params
 * before any handler runs, so the token is available synchronously well
 * before the transport is built -- no middleware-to-transport timing race).
 *
 * Re-expressed for the discovery protocol: the invariant now exercised is
 * that each per-request Server's meta-tool handlers close over the scope
 * RESOLVED FROM THAT REQUEST'S TOKEN (consumer -> allowedMcpIds), so two
 * tokens hitting the same stateless endpoint each see only their own MCPs
 * and a slug outside the resolved scope stays opaque -- the closure never
 * widens past what the token resolved to.
 */

interface TextContent {
  type: string;
  text: string;
}

function parseJsonContent<T>(result: { content?: unknown }): T {
  const content = result.content as TextContent[];
  return JSON.parse(content[0].text) as T;
}

let testApp: TestApp;
let httpServer: HttpServer;
let port: number;

let tokenAlpha: string;
let tokenBeta: string;

function insertStdioMcp(slug: string, purpose: string): string {
  const id = generateId();
  mcpServersRepository.insertServer(testApp.db, {
    id,
    slug,
    name: slug,
    transport: 'stdio',
    command: process.execPath,
    args: [FIXTURE_STDIO_PATH],
    url: null,
    headers: null,
    createdAt: nowIso(),
    // A manual purpose keeps list_mcps a pure DB read (no upstream spawn) --
    // this spike is about scope capture, not the purpose fallback.
    purpose,
    secrets: [],
  });
  return id;
}

function insertConsumer(token: string): string {
  const id = generateId();
  consumersRepository.insertConsumer(testApp.db, {
    id,
    type: 'project',
    name: token,
    path: `/tmp/${token}`,
    token,
    clientFormats: [],
    discovered: false,
    available: true,
    enabled: true,
    createdAt: nowIso(),
  });
  return id;
}

async function connectedClient(token: string): Promise<Client> {
  const client = new Client({ name: `spike-client-${token}`, version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/${token}`)),
  );
  return client;
}

describe('token-resolved scope is captured per-request in the meta-tool handler closure', () => {
  beforeAll(async () => {
    testApp = buildTestApp();
    const outer = express();
    mountGateway(outer, { db: testApp.db, registry: testApp.upstreamRegistry });
    outer.use(testApp.app);
    httpServer = await new Promise<HttpServer>((resolve) => {
      const listening = outer.listen(0, '127.0.0.1', () => resolve(listening));
    });
    port = (httpServer.address() as AddressInfo).port;

    const alphaMcpId = insertStdioMcp('alpha-mcp', 'alpha purpose');
    const betaMcpId = insertStdioMcp('beta-mcp', 'beta purpose');

    tokenAlpha = 'spike-token-alpha';
    tokenBeta = 'spike-token-beta';
    const consumerAlpha = insertConsumer(tokenAlpha);
    const consumerBeta = insertConsumer(tokenBeta);

    assignmentsRepository.assign(testApp.db, consumerAlpha, alphaMcpId);
    assignmentsRepository.assign(testApp.db, consumerBeta, betaMcpId);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await testApp.close();
  });

  it('each token gets only its own resolved scope: list_mcps reflects the token, not the endpoint', async () => {
    const alpha = await connectedClient(tokenAlpha);
    const beta = await connectedClient(tokenBeta);

    const alphaListed = parseJsonContent<{ mcps: Array<{ slug: string }> }>(
      await alpha.callTool({ name: 'list_mcps', arguments: {} }),
    );
    const betaListed = parseJsonContent<{ mcps: Array<{ slug: string }> }>(
      await beta.callTool({ name: 'list_mcps', arguments: {} }),
    );

    expect(alphaListed.mcps.map((mcp) => mcp.slug)).toEqual(['alpha-mcp']);
    expect(betaListed.mcps.map((mcp) => mcp.slug)).toEqual(['beta-mcp']);

    await alpha.close();
    await beta.close();
  });

  it('a slug belonging to the other token is opaque -- the closure never widens past the resolved scope', async () => {
    const alpha = await connectedClient(tokenAlpha);

    const gotOther = await alpha.callTool({
      name: 'get_mcp_tools',
      arguments: { mcp: 'beta-mcp' },
    });
    expect(gotOther.isError).toBe(true);
    expect((gotOther.content as TextContent[])[0].text).toBe(
      'MCP "beta-mcp" is not available for this consumer',
    );

    const calledOther = await alpha.callTool({
      name: 'call_mcp_tool',
      arguments: { mcp: 'beta-mcp', tool: 'ping', args: {} },
    });
    expect(calledOther.isError).toBe(true);

    await alpha.close();
  });
});
