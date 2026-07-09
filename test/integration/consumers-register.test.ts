import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

describe('POST /api/consumers/project, POST /api/consumers/desktop-profile', () => {
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

  it('PRJ-02: POST project with an existing writable path -> 201, persisted', async () => {
    testApp = buildTestApp();
    const path = tempDir('mcp-manager-register-');

    const response = await request(testApp.app).post('/api/consumers/project').send({ path });

    expect(response.status).toBe(201);
    expect(response.body.type).toBe('project');
    expect(response.body.path).toBe(path);
    expect(response.body.token).toBeTruthy();

    const list = await request(testApp.app).get('/api/consumers');
    expect(list.body).toHaveLength(1);
  });

  it('PRJ-03: POST project with a nonexistent path -> 400', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app)
      .post('/api/consumers/project')
      .send({ path: '/definitely/does/not/exist/anywhere' });

    expect(response.status).toBe(400);
  });

  it('PRJ-03: POST project with a non-writable path -> 400', async () => {
    testApp = buildTestApp();
    const path = tempDir('mcp-manager-register-readonly-');
    chmodSync(path, 0o444);

    try {
      const response = await request(testApp.app).post('/api/consumers/project').send({ path });
      expect(response.status).toBe(400);
    } finally {
      chmodSync(path, 0o755);
    }
  });

  it('POST desktop-profile -> 201 with type desktop-profile and a token issued', async () => {
    testApp = buildTestApp();
    const dataDir = tempDir('mcp-manager-desktop-');

    const response = await request(testApp.app)
      .post('/api/consumers/desktop-profile')
      .send({ dataDir, label: 'Claude Desktop' });

    expect(response.status).toBe(201);
    expect(response.body.type).toBe('desktop-profile');
    expect(response.body.token).toBeTruthy();
  });

  it('POST project without a path -> 400', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app).post('/api/consumers/project').send({});

    expect(response.status).toBe(400);
  });
});
