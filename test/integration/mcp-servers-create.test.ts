import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

const FIXTURE_STDIO_PATH = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/dummy-stdio-mcp.ts');

describe('POST /api/mcp-servers, PUT /api/mcp-servers/:id', () => {
  let testApp: TestApp | undefined;

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
  });

  it('MCP-01: creates a stdio MCP -> 201; response never includes secret plaintext, secret row sealed', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({
        name: 'Stdio One',
        kind: 'stdio',
        command: 'npx',
        args: ['-y', 'some-mcp'],
        secrets: [{ envKey: 'API_KEY', value: 'super-secret-plaintext' }],
      });

    expect(response.status).toBe(201);
    expect(response.body.transport).toBe('stdio');
    expect(response.body.secrets).toEqual([{ envKey: 'API_KEY', hasValue: true }]);
    const responseText = JSON.stringify(response.body);
    expect(responseText).not.toContain('super-secret-plaintext');

    const row = testApp.db
      .prepare('SELECT ciphertext FROM secret WHERE mcp_server_id = ?')
      .get(response.body.id) as { ciphertext: string };
    expect(row.ciphertext).not.toContain('super-secret-plaintext');
  });

  it('MCP-02: creates a remote MCP with a url -> 201, transport persisted as http', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Remote One', kind: 'remote', url: 'https://example.com/mcp' });

    expect(response.status).toBe(201);
    expect(response.body.transport).toBe('http');
    expect(response.body.url).toBe('https://example.com/mcp');
  });

  it('MCP-03: duplicate name -> 409', async () => {
    testApp = buildTestApp();
    await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Dup', kind: 'stdio', command: 'npx' });

    const response = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Dup', kind: 'stdio', command: 'npx' });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/already exists/i);
  });

  it('MCP-03: missing name -> 400', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ kind: 'stdio', command: 'npx' });

    expect(response.status).toBe(400);
  });

  it('MCP-03: stdio missing command -> 400', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'No Command', kind: 'stdio' });

    expect(response.status).toBe(400);
  });

  it('MCP-03: remote missing url -> 400', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'No Url', kind: 'remote' });

    expect(response.status).toBe(400);
  });

  it('PUT re-seals a changed secret and returns only its hasValue flag, no plaintext', async () => {
    testApp = buildTestApp();
    const created = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({
        name: 'Updatable',
        kind: 'stdio',
        command: 'npx',
        secrets: [{ envKey: 'TOKEN', value: 'initial-secret' }],
      });

    const response = await request(testApp.app)
      .put(`/api/mcp-servers/${created.body.id}`)
      .send({ secrets: [{ envKey: 'TOKEN', value: 'rotated-secret' }] });

    expect(response.status).toBe(200);
    expect(response.body.secrets).toEqual([{ envKey: 'TOKEN', hasValue: true }]);
    expect(JSON.stringify(response.body)).not.toContain('rotated-secret');
  });

  it('PUT removeSecretKeys deletes the named key while an upserted key persists', async () => {
    testApp = buildTestApp();
    const created = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({
        name: 'Rekeyable',
        kind: 'stdio',
        command: 'uvx',
        secrets: [{ envKey: 'OLD_KEY', value: 'old-value' }],
      });

    const response = await request(testApp.app)
      .put(`/api/mcp-servers/${created.body.id}`)
      .send({
        removeSecretKeys: ['OLD_KEY'],
        secrets: [{ envKey: 'NEW_KEY', value: 'new-value' }],
      });

    expect(response.status).toBe(200);
    expect(response.body.secrets).toEqual([{ envKey: 'NEW_KEY', hasValue: true }]);
  });

  it('PUT drops the live upstream so the next connect re-reads the updated config', async () => {
    testApp = buildTestApp();
    const created = await request(testApp.app).post('/api/mcp-servers').send({
      name: 'Reloadable',
      kind: 'stdio',
      command: process.execPath,
      args: [FIXTURE_STDIO_PATH],
    });
    // Connect it so a live client is cached (spawned with the current config).
    await testApp.upstreamRegistry.getClient(created.body.id);
    expect(testApp.upstreamRegistry.status(created.body.id)).toBe('running');

    await request(testApp.app).put(`/api/mcp-servers/${created.body.id}`).send({ name: 'Reloadable v2' });

    // The cached upstream is dropped -> a stale token/env can never survive an edit.
    expect(testApp.upstreamRegistry.status(created.body.id)).toBe('stopped');
  });

  it('PUT rejects a malformed removeSecretKeys payload with 400', async () => {
    testApp = buildTestApp();
    const created = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Strict', kind: 'stdio', command: 'npx' });

    const response = await request(testApp.app)
      .put(`/api/mcp-servers/${created.body.id}`)
      .send({ removeSecretKeys: [42] });

    expect(response.status).toBe(400);
  });
});
