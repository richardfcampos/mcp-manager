import { dirname, join } from 'node:path';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { generateId, nowIso } from '../../src/db/repository-helpers.js';
import * as assignmentsRepository from '../../src/domain/assignments/assignments-repository.js';
import * as consumersRepository from '../../src/domain/consumers/consumers-repository.js';
import * as mcpServersRepository from '../../src/domain/mcp-servers/mcp-servers-repository.js';
import { UpstreamRegistry } from '../../src/gateway/upstream-registry.js';
import { mountGateway } from '../../src/gateway/gateway-router.js';
import { start as startDummyRemote, type DummyRemoteMcpHandle } from '../fixtures/dummy-remote-mcp.js';

const FIXTURE_STDIO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/dummy-stdio-mcp.ts',
);
const MASTER_KEY = Buffer.alloc(32, 3);

let db: Database.Database;
let registry: UpstreamRegistry;
let httpServer: HttpServer;
let port: number;
let brokenRemote: DummyRemoteMcpHandle;

let tokenAssigned: string;
let tokenUnassigned: string;
let tokenIsolation: string;
let stdioMcpId: string;

function insertStdioMcp(slug: string): string {
  const id = generateId();
  mcpServersRepository.insertServer(db, {
    id,
    slug,
    name: slug,
    transport: 'stdio',
    command: process.execPath,
    args: [FIXTURE_STDIO_PATH],
    url: null,
    headers: null,
    createdAt: nowIso(),
    secrets: [],
  });
  return id;
}

function insertRemoteMcp(slug: string, url: string): string {
  const id = generateId();
  mcpServersRepository.insertServer(db, {
    id,
    slug,
    name: slug,
    transport: 'http',
    command: null,
    args: null,
    url,
    headers: null,
    createdAt: nowIso(),
    secrets: [],
  });
  return id;
}

function insertConsumer(token: string): string {
  const id = generateId();
  consumersRepository.insertConsumer(db, {
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

function gatewayUrl(token: string): URL {
  return new URL(`http://127.0.0.1:${port}/mcp/${token}`);
}

async function connectedClient(token: string): Promise<Client> {
  const client = new Client({ name: `test-client-${token}`, version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(gatewayUrl(token)));
  return client;
}

describe('gateway-router: POST /mcp/:token', () => {
  beforeAll(async () => {
    db = openDatabase(':memory:');
    runMigrations(db);
    registry = new UpstreamRegistry({ db, masterKey: MASTER_KEY });

    const app = express();
    mountGateway(app, { db, registry });
    httpServer = await new Promise<HttpServer>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    port = (httpServer.address() as AddressInfo).port;

    stdioMcpId = insertStdioMcp('stdio-mcp');
    brokenRemote = await startDummyRemote({ failMode: true });
    const brokenMcpId = insertRemoteMcp('broken-remote-mcp', brokenRemote.url);

    tokenAssigned = 'token-assigned-a';
    tokenUnassigned = 'token-unassigned-b';
    tokenIsolation = 'token-isolation-c';

    const consumerA = insertConsumer(tokenAssigned);
    insertConsumer(tokenUnassigned);
    const consumerC = insertConsumer(tokenIsolation);

    assignmentsRepository.assign(db, consumerA, stdioMcpId);
    assignmentsRepository.assign(db, consumerC, stdioMcpId);
    assignmentsRepository.assign(db, consumerC, brokenMcpId);
  });

  afterAll(async () => {
    await registry.shutdown('all');
    await brokenRemote.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    db.close();
  });

  it('GW-01: consumer assigned only stdio-mcp sees only its prefixed tools', async () => {
    const client = await connectedClient(tokenAssigned);
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'stdio-mcp__echo',
      'stdio-mcp__ping',
      'stdio-mcp__read-secret',
    ]);

    await client.close();
  });

  it('GW-01: consumer with no assignments sees no tools from stdio-mcp', async () => {
    const client = await connectedClient(tokenUnassigned);
    const { tools } = await client.listTools();

    expect(tools).toEqual([]);

    await client.close();
  });

  it('GW-02: tools/call on a prefixed tool proxies to the stdio upstream fixture and returns its result', async () => {
    const client = await connectedClient(tokenAssigned);

    const result = await client.callTool({ name: 'stdio-mcp__ping', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;

    expect(content[0]).toMatchObject({ type: 'text', text: 'pong' });

    await client.close();
  });

  it('SEC-02: unknown token -> HTTP 401, no MCP session established, no tools exposed', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp/no-such-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(401);
  });

  it('GW-03: with one healthy and one failMode MCP assigned, only the healthy tools are served', async () => {
    const client = await connectedClient(tokenIsolation);
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'stdio-mcp__echo',
      'stdio-mcp__ping',
      'stdio-mcp__read-secret',
    ]);
    expect(tools.some((tool) => tool.name.startsWith('broken-remote-mcp__'))).toBe(false);

    await client.close();
  });
});
