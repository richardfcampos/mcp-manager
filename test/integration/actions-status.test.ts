import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { start as startDummyRemote, type DummyRemoteMcpHandle } from '../fixtures/dummy-remote-mcp.js';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

const FIXTURE_STDIO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/dummy-stdio-mcp.ts',
);

describe('GET /api/actions/status', () => {
  let testApp: TestApp | undefined;
  let remoteHandles: DummyRemoteMcpHandle[];

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
    await Promise.all(remoteHandles?.map((handle) => handle.close()) ?? []);
    remoteHandles = [];
  });

  it('enumerates every registered MCP; a never-connected one defaults to stopped', async () => {
    testApp = buildTestApp();
    remoteHandles = [];
    const created = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Never Connected MCP', kind: 'stdio', command: 'npx' });

    const response = await request(testApp.app).get('/api/actions/status');

    expect(response.status).toBe(200);
    const entry = (response.body.statuses as Array<{ mcpId: string; status: string }>).find(
      (s) => s.mcpId === created.body.id,
    );
    expect(entry).toEqual({ mcpId: created.body.id, slug: created.body.slug, status: 'stopped' });
  });

  it('a connected upstream reports status running', async () => {
    testApp = buildTestApp();
    remoteHandles = [];
    const created = await request(testApp.app).post('/api/mcp-servers').send({
      name: 'Connectable MCP',
      kind: 'stdio',
      command: process.execPath,
      args: [FIXTURE_STDIO_PATH],
    });
    await testApp.upstreamRegistry.getClient(created.body.id);

    const response = await request(testApp.app).get('/api/actions/status');

    const entry = (response.body.statuses as Array<{ mcpId: string; status: string }>).find(
      (s) => s.mcpId === created.body.id,
    );
    expect(entry?.status).toBe('running');
  });

  it('a failed upstream reports status error, without omitting it or crashing the response', async () => {
    testApp = buildTestApp();
    const brokenRemote = await startDummyRemote({ failMode: true });
    remoteHandles = [brokenRemote];
    const created = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Broken MCP', kind: 'remote', url: brokenRemote.url });
    await expect(testApp.upstreamRegistry.getClient(created.body.id)).rejects.toThrow();

    const response = await request(testApp.app).get('/api/actions/status');

    expect(response.status).toBe(200);
    const entry = (
      response.body.statuses as Array<{ mcpId: string; status: string; error?: string }>
    ).find((s) => s.mcpId === created.body.id);
    expect(entry?.status).toBe('error');
    // The failure reason is surfaced so the UI can explain WHY, not just flag it.
    expect(typeof entry?.error).toBe('string');
    expect(entry?.error).not.toBe('');
  });

  it('POST test-mcp connects a lazy upstream on demand and reports running', async () => {
    testApp = buildTestApp();
    remoteHandles = [];
    const created = await request(testApp.app).post('/api/mcp-servers').send({
      name: 'Testable MCP',
      kind: 'stdio',
      command: process.execPath,
      args: [FIXTURE_STDIO_PATH],
    });

    const response = await request(testApp.app)
      .post('/api/actions/test-mcp')
      .send({ mcpId: created.body.id });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      mcpId: created.body.id,
      slug: created.body.slug,
      status: 'running',
    });
  });

  it('POST test-mcp reports a broken upstream as error with the reason (HTTP 200)', async () => {
    testApp = buildTestApp();
    const brokenRemote = await startDummyRemote({ failMode: true });
    remoteHandles = [brokenRemote];
    const created = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Untestable MCP', kind: 'remote', url: brokenRemote.url });

    const response = await request(testApp.app)
      .post('/api/actions/test-mcp')
      .send({ mcpId: created.body.id });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('error');
    expect(typeof response.body.error).toBe('string');
    expect(response.body.error).not.toBe('');
  });

  it('POST test-mcp validates input: missing mcpId is 400, unknown id is 404', async () => {
    testApp = buildTestApp();
    remoteHandles = [];

    const missing = await request(testApp.app).post('/api/actions/test-mcp').send({});
    expect(missing.status).toBe(400);

    const unknown = await request(testApp.app)
      .post('/api/actions/test-mcp')
      .send({ mcpId: 'no-such-id' });
    expect(unknown.status).toBe(404);
  });

  it('all three statuses (stopped, running, error) coexist in one response without omission', async () => {
    testApp = buildTestApp();
    const brokenRemote = await startDummyRemote({ failMode: true });
    remoteHandles = [brokenRemote];

    const stopped = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Coexist Stopped', kind: 'stdio', command: 'npx' });
    const running = await request(testApp.app).post('/api/mcp-servers').send({
      name: 'Coexist Running',
      kind: 'stdio',
      command: process.execPath,
      args: [FIXTURE_STDIO_PATH],
    });
    const errored = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Coexist Error', kind: 'remote', url: brokenRemote.url });
    await testApp.upstreamRegistry.getClient(running.body.id);
    await expect(testApp.upstreamRegistry.getClient(errored.body.id)).rejects.toThrow();

    const response = await request(testApp.app).get('/api/actions/status');

    const byId = new Map(
      (response.body.statuses as Array<{ mcpId: string; status: string }>).map((s) => [
        s.mcpId,
        s.status,
      ]),
    );
    expect(byId.get(stopped.body.id)).toBe('stopped');
    expect(byId.get(running.body.id)).toBe('running');
    expect(byId.get(errored.body.id)).toBe('error');
  });
});
