import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectUpstream } from '../../src/gateway/upstream-client.js';
import { start as startDummyRemote, type DummyRemoteMcpHandle } from '../fixtures/dummy-remote-mcp.js';

const FIXTURE_STDIO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/dummy-stdio-mcp.ts',
);

describe('upstream-client: connectUpstream', () => {
  let client: Client | undefined;
  let remoteHandle: DummyRemoteMcpHandle | undefined;

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    client = undefined;
    await remoteHandle?.close();
    remoteHandle = undefined;
  });

  it('GW-02: connects to a stdio upstream and lists the fixture tools (stdio run in-process and proxied)', async () => {
    client = await connectUpstream(
      { transport: 'stdio', command: process.execPath, args: [FIXTURE_STDIO_PATH] },
      {},
    );

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(['echo', 'ping', 'read-secret']);
  });

  it('GW-02: a decrypted secret passed in is present in the spawned child env and echoed back', async () => {
    client = await connectUpstream(
      { transport: 'stdio', command: process.execPath, args: [FIXTURE_STDIO_PATH] },
      { FIXTURE_SECRET: 'super-secret-value' },
    );

    const result = await client.callTool({ name: 'read-secret', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;

    expect(content[0]).toMatchObject({ type: 'text', text: 'super-secret-value' });
  });

  it('GW-03: connects to a remote upstream and the fixture recorded the injected Authorization header', async () => {
    remoteHandle = await startDummyRemote();

    client = await connectUpstream(
      { transport: 'http', url: remoteHandle.url },
      { Authorization: 'Bearer test-token' },
    );

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(['remote-ping']);
    expect(
      remoteHandle.receivedHeaders.some(
        (headers) => headers['authorization'] === 'Bearer test-token',
      ),
    ).toBe(true);
  });
});
