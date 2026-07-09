import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { getByToken } from '../../src/domain/consumers/consumers-service.js';
import { MANAGED_KEY } from '../../src/config-writers/managed-block.js';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

describe('POST /api/actions/rotate-token', () => {
  let testApp: TestApp | undefined;
  const createdDirs: string[] = [];

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    createdDirs.push(dir);
    return dir;
  }

  it('rotate returns a new token distinct from the old one, persisted on the consumer', async () => {
    testApp = buildTestApp();
    const path = tempDir('mcp-manager-rotate-');
    const project = await request(testApp.app).post('/api/consumers/project').send({ path });
    const oldToken = project.body.token as string;

    const response = await request(testApp.app)
      .post('/api/actions/rotate-token')
      .send({ consumerId: project.body.id });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTruthy();
    expect(response.body.token).not.toBe(oldToken);

    const list = await request(testApp.app).get('/api/consumers');
    const updated = (list.body as Array<{ id: string; token: string }>).find(
      (c) => c.id === project.body.id,
    );
    expect(updated?.token).toBe(response.body.token);
  });

  it('the old token no longer resolves to the consumer after rotation', async () => {
    testApp = buildTestApp();
    const path = tempDir('mcp-manager-rotate-');
    const project = await request(testApp.app).post('/api/consumers/project').send({ path });
    const oldToken = project.body.token as string;

    await request(testApp.app).post('/api/actions/rotate-token').send({ consumerId: project.body.id });

    expect(getByToken({ db: testApp.db }, oldToken)).toBeNull();
  });

  it('the affected config is rewritten to embed the new token URL', async () => {
    testApp = buildTestApp();
    const path = tempDir('mcp-manager-rotate-');
    const project = await request(testApp.app).post('/api/consumers/project').send({ path });
    const mcpServer = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Rotate MCP', kind: 'stdio', command: 'npx' });
    await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId: project.body.id, mcpServerId: mcpServer.body.id });
    await request(testApp.app).post('/api/actions/write-configs').send({});

    const rotate = await request(testApp.app)
      .post('/api/actions/rotate-token')
      .send({ consumerId: project.body.id });

    const config = JSON.parse(readFileSync(join(path, '.mcp.json'), 'utf-8')) as {
      mcpServers: Record<string, { url: string }>;
    };
    expect(config.mcpServers[MANAGED_KEY].url).toBe(
      `${testApp.gatewayBaseUrl}/mcp/${rotate.body.token}`,
    );
  });

  it('rotate-token for an unknown consumer -> 404', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app)
      .post('/api/actions/rotate-token')
      .send({ consumerId: 'no-such-consumer' });

    expect(response.status).toBe(404);
  });
});
