import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MANAGED_KEY } from '../../src/config-writers/managed-block.js';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

describe('GET /api/actions/preview', () => {
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

  it('returns the rendered managed-block config content the write-configs action would produce', async () => {
    testApp = buildTestApp();
    const path = tempDir('mcp-manager-preview-');
    const project = await request(testApp.app).post('/api/consumers/project').send({ path });
    const mcpServer = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Previewed MCP', kind: 'stdio', command: 'npx' });
    await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId: project.body.id, mcpServerId: mcpServer.body.id });

    const preview = await request(testApp.app)
      .get('/api/actions/preview')
      .query({ consumerId: project.body.id });
    const written = await request(testApp.app).post('/api/actions/write-configs').send({});

    expect(preview.status).toBe(200);
    const previewedConfig = JSON.parse(preview.text) as {
      mcpServers: Record<string, { type: string; url: string }>;
    };
    expect(previewedConfig.mcpServers[MANAGED_KEY]).toEqual({
      type: 'http',
      url: `${testApp.gatewayBaseUrl}/mcp/${project.body.token}`,
      headers: { Authorization: `Bearer ${project.body.token}` },
    });
    expect(written.status).toBe(200);
  });

  it('never creates or modifies a file on disk during preview', async () => {
    testApp = buildTestApp();
    const path = tempDir('mcp-manager-preview-nowrite-');
    const project = await request(testApp.app).post('/api/consumers/project').send({ path });
    const mcpServer = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'No Write MCP', kind: 'stdio', command: 'npx' });
    await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId: project.body.id, mcpServerId: mcpServer.body.id });
    const configPath = join(path, '.mcp.json');
    expect(existsSync(configPath)).toBe(false);

    await request(testApp.app).get('/api/actions/preview').query({ consumerId: project.body.id });

    expect(existsSync(configPath)).toBe(false);
  });

  it('preview for an unknown consumer -> 404', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app)
      .get('/api/actions/preview')
      .query({ consumerId: 'no-such-consumer' });

    expect(response.status).toBe(404);
  });

  it('preview without a consumerId query param -> 400', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app).get('/api/actions/preview');

    expect(response.status).toBe(400);
  });
});
