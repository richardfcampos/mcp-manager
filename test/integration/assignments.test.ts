import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

describe('POST/DELETE/GET /api/assignments', () => {
  let testApp: TestApp | undefined;
  const createdDirs: string[] = [];

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setupConsumerAndMcp(app: TestApp) {
    const path = mkdtempSync(join(tmpdir(), 'mcp-manager-assign-'));
    createdDirs.push(path);
    const consumer = await request(app.app).post('/api/consumers/project').send({ path });
    const mcpServer = await request(app.app)
      .post('/api/mcp-servers')
      .send({ name: 'Assignable MCP', kind: 'stdio', command: 'npx' });
    return { consumerId: consumer.body.id as string, mcpServerId: mcpServer.body.id as string };
  }

  it('ACC-01: POST assign persists an assignment -> 201', async () => {
    testApp = buildTestApp();
    const { consumerId, mcpServerId } = await setupConsumerAndMcp(testApp);

    const response = await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId, mcpServerId });

    expect(response.status).toBe(201);
    const matrix = await request(testApp.app).get('/api/assignments');
    const row = (
      matrix.body.consumers as Array<{ consumerId: string; allowedMcpIds: string[] }>
    ).find((c) => c.consumerId === consumerId);
    expect(row?.allowedMcpIds).toEqual([mcpServerId]);
  });

  it('ACC-01: DELETE unassign removes the row -> 200', async () => {
    testApp = buildTestApp();
    const { consumerId, mcpServerId } = await setupConsumerAndMcp(testApp);
    await request(testApp.app).post('/api/assignments').send({ consumerId, mcpServerId });

    const response = await request(testApp.app)
      .delete('/api/assignments')
      .send({ consumerId, mcpServerId });

    expect(response.status).toBe(200);
    const matrix = await request(testApp.app).get('/api/assignments');
    const row = (
      matrix.body.consumers as Array<{ consumerId: string; allowedMcpIds: string[] }>
    ).find((c) => c.consumerId === consumerId);
    expect(row?.allowedMcpIds).toEqual([]);
  });

  it('GET matrix returns allowedMcpIds per consumer / consumersOfMcp per MCP consistent with the DB', async () => {
    testApp = buildTestApp();
    const { consumerId, mcpServerId } = await setupConsumerAndMcp(testApp);
    await request(testApp.app).post('/api/assignments').send({ consumerId, mcpServerId });

    const response = await request(testApp.app).get('/api/assignments');

    expect(response.status).toBe(200);
    const consumerRow = (
      response.body.consumers as Array<{ consumerId: string; allowedMcpIds: string[] }>
    ).find((c) => c.consumerId === consumerId);
    const mcpRow = (
      response.body.mcpServers as Array<{ mcpServerId: string; consumerIds: string[] }>
    ).find((m) => m.mcpServerId === mcpServerId);
    expect(consumerRow?.allowedMcpIds).toEqual([mcpServerId]);
    expect(mcpRow?.consumerIds).toEqual([consumerId]);
  });

  it('duplicate assign is idempotent: no duplicate row, no 500', async () => {
    testApp = buildTestApp();
    const { consumerId, mcpServerId } = await setupConsumerAndMcp(testApp);

    const first = await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId, mcpServerId });
    const second = await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId, mcpServerId });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const matrix = await request(testApp.app).get('/api/assignments');
    const row = (
      matrix.body.consumers as Array<{ consumerId: string; allowedMcpIds: string[] }>
    ).find((c) => c.consumerId === consumerId);
    expect(row?.allowedMcpIds).toEqual([mcpServerId]);
  });

  it('POST assign with a nonexistent consumer or MCP -> 404', async () => {
    testApp = buildTestApp();
    const { mcpServerId } = await setupConsumerAndMcp(testApp);

    const response = await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId: 'no-such-consumer', mcpServerId });

    expect(response.status).toBe(404);
  });
});
