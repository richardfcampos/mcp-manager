import { dirname, join } from 'node:path';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generateId, nowIso } from '../../src/db/repository-helpers.js';
import * as assignmentsRepository from '../../src/domain/assignments/assignments-repository.js';
import * as consumersRepository from '../../src/domain/consumers/consumers-repository.js';
import { mountGateway } from '../../src/gateway/gateway-router.js';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

const FIXTURE_STDIO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/dummy-stdio-mcp.ts',
);

// Plaintext secrets, upstream commands and spawn paths that must NEVER surface
// in any meta-tool response -- success or failure (SEC-10).
const HEALTHY_SECRET = 'super-secret-plaintext';
const BROKEN_SECRET = 'another-secret-plaintext';
const BROKEN_COMMAND = '/nonexistent/bin/does-not-exist-xyz';
const BROKEN_ARG = '--broken-flag-should-not-leak';

let testApp: TestApp;
let httpServer: HttpServer;
let port: number;
let consumerToken: string;

/** Substrings whose appearance in any serialized meta-tool response is a
 * SEC-10 leak: secret plaintext, the sealed ciphertext, the upstream command
 * / args, and the raw spawn-error markers that carry filesystem paths. */
let forbidden: string[];

async function connectedClient(): Promise<Client> {
  const client = new Client({ name: 'secret-isolation-client', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/${consumerToken}`)),
  );
  return client;
}

function assertNoLeak(label: string, serialized: string): void {
  for (const needle of forbidden) {
    expect(serialized, `${label} leaked "${needle}"`).not.toContain(needle);
  }
}

function ciphertextFor(mcpServerId: string): string {
  const row = testApp.db
    .prepare('SELECT ciphertext FROM secret WHERE mcp_server_id = ?')
    .get(mcpServerId) as { ciphertext: string };
  return row.ciphertext;
}

/**
 * SEC-10: no meta-tool response -- on any success or failure path -- may
 * contain a secret plaintext/ciphertext, the upstream command/args, or a raw
 * spawn error carrying filesystem paths. Secrets stay sealed in the vault;
 * the gateway only ever exposes slug/name/purpose and upstream tool data.
 */
describe('gateway secret isolation: meta-tool responses never leak secrets or upstream config', () => {
  beforeAll(async () => {
    testApp = buildTestApp();
    const outer = express();
    mountGateway(outer, { db: testApp.db, registry: testApp.upstreamRegistry });
    outer.use(testApp.app);
    httpServer = await new Promise<HttpServer>((resolve) => {
      const listening = outer.listen(0, '127.0.0.1', () => resolve(listening));
    });
    port = (httpServer.address() as AddressInfo).port;

    // Healthy upstream: a real spawnable stdio MCP carrying a secret (success
    // paths). The API seals the secret exactly as production does (SEC-01).
    const healthyRes = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({
        name: 'healthy-secret-mcp',
        kind: 'stdio',
        command: process.execPath,
        args: [FIXTURE_STDIO_PATH],
        secrets: [{ envKey: 'API_KEY', value: HEALTHY_SECRET }],
      });
    expect(healthyRes.status).toBe(201);
    const healthyId = healthyRes.body.id as string;

    // Broken upstream: command points at a nonexistent binary so every
    // getClient throws a raw spawn error (`spawn <path> ENOENT`) -- the
    // failure paths that must be sanitized.
    const brokenRes = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({
        name: 'broken-secret-mcp',
        kind: 'stdio',
        command: BROKEN_COMMAND,
        args: [BROKEN_ARG],
        secrets: [{ envKey: 'BROKEN_KEY', value: BROKEN_SECRET }],
      });
    expect(brokenRes.status).toBe(201);
    const brokenId = brokenRes.body.id as string;

    consumerToken = 'secret-isolation-token';
    const consumerId = generateId();
    consumersRepository.insertConsumer(testApp.db, {
      id: consumerId,
      type: 'project',
      name: consumerToken,
      path: `/tmp/${consumerToken}`,
      token: consumerToken,
      clientFormats: [],
      discovered: false,
      available: true,
      enabled: true,
      createdAt: nowIso(),
    });
    assignmentsRepository.assign(testApp.db, consumerId, healthyId);
    assignmentsRepository.assign(testApp.db, consumerId, brokenId);

    forbidden = [
      HEALTHY_SECRET,
      BROKEN_SECRET,
      ciphertextFor(healthyId),
      ciphertextFor(brokenId),
      process.execPath,
      FIXTURE_STDIO_PATH,
      BROKEN_COMMAND,
      BROKEN_ARG,
      'spawn',
      'ENOENT',
    ];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await testApp.close();
  });

  it('SEC-10: list_mcps (healthy + a down upstream in the same list) leaks nothing', async () => {
    const client = await connectedClient();

    const result = await client.callTool({ name: 'list_mcps', arguments: {} });
    assertNoLeak('list_mcps', JSON.stringify(result));

    await client.close();
  });

  it('SEC-10: get_mcp_tools leaks nothing on the success path or the sanitized failure path', async () => {
    const client = await connectedClient();

    const success = await client.callTool({
      name: 'get_mcp_tools',
      arguments: { mcp: 'healthy-secret-mcp' },
    });
    assertNoLeak('get_mcp_tools success', JSON.stringify(success));

    const failure = await client.callTool({
      name: 'get_mcp_tools',
      arguments: { mcp: 'broken-secret-mcp' },
    });
    // The raw `spawn <path> ENOENT` is sanitized to an opaque reach error.
    expect(failure.isError).toBe(true);
    assertNoLeak('get_mcp_tools failure', JSON.stringify(failure));

    await client.close();
  });

  it('SEC-10: call_mcp_tool leaks nothing on success, sanitized failure, or validation-error paths', async () => {
    const client = await connectedClient();

    const success = await client.callTool({
      name: 'call_mcp_tool',
      arguments: { mcp: 'healthy-secret-mcp', tool: 'ping', args: {} },
    });
    expect(success.isError).toBeFalsy();
    assertNoLeak('call_mcp_tool success', JSON.stringify(success));

    const failure = await client.callTool({
      name: 'call_mcp_tool',
      arguments: { mcp: 'broken-secret-mcp', tool: 'ping', args: {} },
    });
    expect(failure.isError).toBe(true);
    assertNoLeak('call_mcp_tool failure', JSON.stringify(failure));

    // Malformed payload (DISC-06) is a validation error path -- still no leak.
    const malformed = await client.callTool({
      name: 'call_mcp_tool',
      arguments: { mcp: 'healthy-secret-mcp' },
    });
    expect(malformed.isError).toBe(true);
    assertNoLeak('call_mcp_tool malformed', JSON.stringify(malformed));

    await client.close();
  });
});
