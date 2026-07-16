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

/** The 3 meta-tools tools/list must always expose (DISC-01), sorted. */
const META_TOOL_NAMES = ['call_mcp_tool', 'get_mcp_tools', 'list_mcps'];

/** First 400 chars of the fixture's announced instructions is what list_mcps
 * emits as the fallback purpose (DESC-02) -- this prefix proves the text came
 * from the upstream and was truncated at the cap. */
const FIXTURE_INSTRUCTIONS_PREFIX =
  'FIXTURE_INSTRUCTIONS: This dummy stdio MCP is a gateway integration-test fixture.';

interface TextContent {
  type: string;
  text: string;
}

let testApp: TestApp;
let httpServer: HttpServer;
let port: number;

let tokenAssigned: string;
let tokenEmpty: string;

function insertStdioMcp(slug: string, purpose: string | null): string {
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
  const client = new Client({ name: `test-client-${token}`, version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/${token}`)),
  );
  return client;
}

/** Parses the JSON text content that list_mcps / get_mcp_tools return. */
function parseJsonContent<T>(result: { content?: unknown }): T {
  const content = result.content as TextContent[];
  return JSON.parse(content[0].text) as T;
}

describe('gateway discovery: meta-tools over POST /mcp/:token', () => {
  beforeAll(async () => {
    // buildTestApp owns the isolated in-memory DB + upstream registry + close
    // lifecycle; the gateway is mounted on an outer app that wraps the /api
    // app exactly as the production server assembles it (server.ts).
    testApp = buildTestApp();
    const outer = express();
    mountGateway(outer, { db: testApp.db, registry: testApp.upstreamRegistry });
    outer.use(testApp.app);
    httpServer = await new Promise<HttpServer>((resolve) => {
      const listening = outer.listen(0, '127.0.0.1', () => resolve(listening));
    });
    port = (httpServer.address() as AddressInfo).port;

    // Assigned consumer gets one stdio MCP with NO manual purpose (so the
    // DESC-02 instructions fallback is exercised). A second MCP is assigned to
    // a DIFFERENT consumer to drive the out-of-scope path (DISC-05).
    const stdioMcpId = insertStdioMcp('stdio-mcp', null);
    const otherMcpId = insertStdioMcp('other-mcp', null);

    tokenAssigned = 'disc-token-assigned';
    tokenEmpty = 'disc-token-empty';
    const tokenOther = 'disc-token-other';

    const consumerAssigned = insertConsumer(tokenAssigned);
    insertConsumer(tokenEmpty);
    const consumerOther = insertConsumer(tokenOther);

    assignmentsRepository.assign(testApp.db, consumerAssigned, stdioMcpId);
    assignmentsRepository.assign(testApp.db, consumerOther, otherMcpId);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await testApp.close();
  });

  it('DISC-01: tools/list exposes exactly the 3 meta-tools for an assigned consumer', async () => {
    const client = await connectedClient(tokenAssigned);
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(META_TOOL_NAMES);

    await client.close();
  });

  it('DISC-01: tools/list still exposes the 3 meta-tools for a consumer with 0 MCPs', async () => {
    const client = await connectedClient(tokenEmpty);
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(META_TOOL_NAMES);

    await client.close();
  });

  it('DISC-02/03/04: full list_mcps -> get_mcp_tools -> call_mcp_tool flow against the stdio fixture', async () => {
    const client = await connectedClient(tokenAssigned);

    // list_mcps -> only the assigned MCP, projected to {slug, name, purpose}.
    const listed = parseJsonContent<{
      mcps: Array<{ slug: string; name: string; purpose: string | null }>;
    }>(await client.callTool({ name: 'list_mcps', arguments: {} }));
    expect(listed.mcps).toHaveLength(1);
    expect(listed.mcps[0]).toMatchObject({ slug: 'stdio-mcp', name: 'stdio-mcp' });

    // get_mcp_tools -> the upstream's tools with ORIGINAL names (no slug prefix).
    const gotTools = parseJsonContent<{
      mcp: string;
      tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    }>(await client.callTool({ name: 'get_mcp_tools', arguments: { mcp: 'stdio-mcp' } }));
    expect(gotTools.mcp).toBe('stdio-mcp');
    expect(gotTools.tools.map((tool) => tool.name).sort()).toEqual(['echo', 'ping', 'read-secret']);
    expect(gotTools.tools.find((tool) => tool.name === 'ping')?.inputSchema).toBeDefined();

    // call_mcp_tool -> upstream result proxied verbatim.
    const called = await client.callTool({
      name: 'call_mcp_tool',
      arguments: { mcp: 'stdio-mcp', tool: 'ping', args: {} },
    });
    expect((called.content as TextContent[])[0]).toMatchObject({ type: 'text', text: 'pong' });
    expect(called.isError).toBeFalsy();

    await client.close();
  });

  it('DISC-08: a stray top-level field is rejected by the gateway, not forwarded as an argument-less call', async () => {
    const client = await connectedClient(tokenAssigned);

    // The real-world regression, end to end: the calling AI used `input` for
    // the tool's arguments. The old optional `arguments` field read as absent,
    // so the gateway forwarded undefined and the upstream answered with an
    // opaque schema error. The gateway must own this error and name `args`.
    const strayField = await client.callTool({
      name: 'call_mcp_tool',
      arguments: { mcp: 'stdio-mcp', tool: 'echo', input: { text: 'hi' } },
    });

    expect(strayField.isError).toBe(true);
    const text = (strayField.content as TextContent[])[0].text;
    expect(text).toContain('"input"');
    expect(text).toContain('args');

    // The now-renamed field is itself just an unknown field.
    const oldFieldName = await client.callTool({
      name: 'call_mcp_tool',
      arguments: { mcp: 'stdio-mcp', tool: 'echo', arguments: { text: 'hi' } },
    });
    expect(oldFieldName.isError).toBe(true);
    expect((oldFieldName.content as TextContent[])[0].text).toContain('"arguments"');

    await client.close();
  });

  it('DISC-02: list_mcps returns an empty list (not an error) for a consumer with 0 MCPs', async () => {
    const client = await connectedClient(tokenEmpty);

    const listed = parseJsonContent<{ mcps: unknown[] }>(
      await client.callTool({ name: 'list_mcps', arguments: {} }),
    );
    expect(listed.mcps).toEqual([]);

    await client.close();
  });

  it('DISC-05: a slug assigned to another consumer yields the same opaque isError as a nonexistent slug', async () => {
    const client = await connectedClient(tokenAssigned);

    // 'other-mcp' exists but belongs to another consumer; a totally unknown
    // slug never existed. Both must produce the SAME opaque error so the
    // response never reveals a MCP owned by someone else.
    const outOfScope = await client.callTool({
      name: 'get_mcp_tools',
      arguments: { mcp: 'other-mcp' },
    });
    const nonexistent = await client.callTool({
      name: 'get_mcp_tools',
      arguments: { mcp: 'no-such-mcp-anywhere' },
    });

    expect(outOfScope.isError).toBe(true);
    const outOfScopeText = (outOfScope.content as TextContent[])[0].text;
    expect(outOfScopeText).toContain('not available for this consumer');
    // Opacity: message shape is identical, differing only by the echoed slug.
    expect(outOfScopeText).toBe('MCP "other-mcp" is not available for this consumer');
    expect((nonexistent.content as TextContent[])[0].text).toBe(
      'MCP "no-such-mcp-anywhere" is not available for this consumer',
    );

    // call_mcp_tool is opaque the same way and never proxies out of scope.
    const calledOutOfScope = await client.callTool({
      name: 'call_mcp_tool',
      arguments: { mcp: 'other-mcp', tool: 'ping', args: {} },
    });
    expect(calledOutOfScope.isError).toBe(true);
    // Pin the reason: a well-formed payload must fail scope resolution, not the
    // unknown-field guard that precedes it.
    expect((calledOutOfScope.content as TextContent[])[0].text).toBe(
      'MCP "other-mcp" is not available for this consumer',
    );

    await client.close();
  });

  it('DESC-02: with no manual purpose, list_mcps uses the upstream instructions truncated to 400 chars', async () => {
    const client = await connectedClient(tokenAssigned);

    const listed = parseJsonContent<{ mcps: Array<{ purpose: string | null }> }>(
      await client.callTool({ name: 'list_mcps', arguments: {} }),
    );
    const purpose = listed.mcps[0].purpose;

    expect(purpose).not.toBeNull();
    expect(purpose).toHaveLength(400);
    expect(purpose?.startsWith(FIXTURE_INSTRUCTIONS_PREFIX)).toBe(true);

    await client.close();
  });
});
