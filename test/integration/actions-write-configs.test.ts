import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MANAGED_KEY } from '../../src/config-writers/managed-block.js';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

describe('POST /api/actions/write-configs', () => {
  let testApp: TestApp | undefined;
  const createdDirs: string[] = [];

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
    for (const dir of createdDirs.splice(0)) {
      try {
        chmodSync(dir, 0o755);
      } catch {
        // best-effort restore before cleanup
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    createdDirs.push(dir);
    return dir;
  }

  async function registerProject(app: TestApp, path: string): Promise<{ id: string; token: string }> {
    const response = await request(app.app).post('/api/consumers/project').send({ path });
    return { id: response.body.id, token: response.body.token };
  }

  it('CFG-01: writes .mcp.json at the project root with a type:http entry pointing at the gateway URL', async () => {
    testApp = buildTestApp();
    const path = tempDir('mcp-manager-write-configs-');
    const project = await registerProject(testApp, path);
    const mcpServer = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Written MCP', kind: 'stdio', command: 'npx' });
    await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId: project.id, mcpServerId: mcpServer.body.id });

    const response = await request(testApp.app).post('/api/actions/write-configs').send({});

    expect(response.status).toBe(200);
    const config = JSON.parse(readFileSync(join(path, '.mcp.json'), 'utf-8')) as {
      mcpServers: Record<string, { type: string; url: string }>;
    };
    expect(config.mcpServers[MANAGED_KEY]).toEqual({
      type: 'http',
      url: `${testApp.gatewayBaseUrl}/mcp/${project.token}`,
      headers: { Authorization: `Bearer ${project.token}` },
    });
  });

  it('CFG-02: a second identical write produces a byte-identical file (idempotent)', async () => {
    testApp = buildTestApp();
    const path = tempDir('mcp-manager-write-configs-');
    const project = await registerProject(testApp, path);
    const mcpServer = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Idempotent MCP', kind: 'stdio', command: 'npx' });
    await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId: project.id, mcpServerId: mcpServer.body.id });

    await request(testApp.app).post('/api/actions/write-configs').send({});
    const firstContent = readFileSync(join(path, '.mcp.json'), 'utf-8');
    const secondResponse = await request(testApp.app).post('/api/actions/write-configs').send({});
    const secondContent = readFileSync(join(path, '.mcp.json'), 'utf-8');

    expect(secondContent).toBe(firstContent);
    const results = secondResponse.body.results as Array<{ consumerId: string; status: string }>;
    expect(results.find((r) => r.consumerId === project.id)?.status).toBe('unchanged');
  });

  it('CFG-02: one project write failure is isolated and reported; other projects still written', async () => {
    testApp = buildTestApp();
    const okPath = tempDir('mcp-manager-write-configs-ok-');
    const brokenPath = tempDir('mcp-manager-write-configs-broken-');
    const okProject = await registerProject(testApp, okPath);
    const brokenProject = await registerProject(testApp, brokenPath);
    const mcpServer = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Shared MCP', kind: 'stdio', command: 'npx' });
    await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId: okProject.id, mcpServerId: mcpServer.body.id });
    await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId: brokenProject.id, mcpServerId: mcpServer.body.id });

    chmodSync(brokenPath, 0o555); // read+execute only: writeFileSync inside it fails

    const response = await request(testApp.app).post('/api/actions/write-configs').send({});

    expect(response.status).toBe(200);
    const results = response.body.results as Array<{
      consumerId: string;
      status: string;
      error?: string;
    }>;
    const okResult = results.find((r) => r.consumerId === okProject.id);
    const brokenResult = results.find((r) => r.consumerId === brokenProject.id);
    expect(okResult?.status).toBe('written');
    expect(brokenResult?.status).toBe('error');
    expect(brokenResult?.error).toBeTruthy();
    expect(existsSync(join(okPath, '.mcp.json'))).toBe(true);
  });

  it('CFG-02: a project with 0 assignments has its managed gateway entry removed/cleaned', async () => {
    testApp = buildTestApp();
    const path = tempDir('mcp-manager-write-configs-cleanup-');
    const project = await registerProject(testApp, path);
    const mcpServer = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Removable MCP', kind: 'stdio', command: 'npx' });
    await request(testApp.app)
      .post('/api/assignments')
      .send({ consumerId: project.id, mcpServerId: mcpServer.body.id });
    await request(testApp.app).post('/api/actions/write-configs').send({});
    const beforeConfig = JSON.parse(readFileSync(join(path, '.mcp.json'), 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(beforeConfig.mcpServers[MANAGED_KEY]).toBeDefined();

    await request(testApp.app)
      .delete('/api/assignments')
      .send({ consumerId: project.id, mcpServerId: mcpServer.body.id });
    const response = await request(testApp.app).post('/api/actions/write-configs').send({});

    expect(response.status).toBe(200);
    const afterConfig = JSON.parse(readFileSync(join(path, '.mcp.json'), 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(afterConfig.mcpServers[MANAGED_KEY]).toBeUndefined();
    const results = response.body.results as Array<{ consumerId: string; status: string }>;
    expect(results.find((r) => r.consumerId === project.id)?.status).toBe('removed');
  });
});
