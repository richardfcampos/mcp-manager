import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

describe('PUT /api/consumers/:id/formats', () => {
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

  async function registerProject(): Promise<string> {
    const path = tempDir('mcp-manager-formats-');
    const response = await request(testApp!.app).post('/api/consumers/project').send({ path });
    return response.body.id as string;
  }

  it('FMT-1: a valid clientFormats array persists and is returned in the updated consumer', async () => {
    testApp = buildTestApp();
    const id = await registerProject();

    const response = await request(testApp.app)
      .put(`/api/consumers/${id}/formats`)
      .send({ clientFormats: ['cursor', 'vscode'] });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(id);
    expect(response.body.clientFormats).toEqual(['cursor', 'vscode']);

    const list = await request(testApp.app).get('/api/consumers');
    const persisted = (list.body as Array<{ id: string; clientFormats: string[] }>).find(
      (consumer) => consumer.id === id,
    );
    expect(persisted?.clientFormats).toEqual(['cursor', 'vscode']);
  });

  it('FMT-2: an invalid format value -> 400, nothing persisted', async () => {
    testApp = buildTestApp();
    const id = await registerProject();

    const response = await request(testApp.app)
      .put(`/api/consumers/${id}/formats`)
      .send({ clientFormats: ['not-a-real-format'] });

    expect(response.status).toBe(400);

    const list = await request(testApp.app).get('/api/consumers');
    const persisted = (list.body as Array<{ id: string; clientFormats: string[] }>).find(
      (consumer) => consumer.id === id,
    );
    expect(persisted?.clientFormats).toEqual([]);
  });

  it('FMT-2: a non-array clientFormats -> 400', async () => {
    testApp = buildTestApp();
    const id = await registerProject();

    const response = await request(testApp.app)
      .put(`/api/consumers/${id}/formats`)
      .send({ clientFormats: 'cursor' });

    expect(response.status).toBe(400);
  });

  it('FMT-2: a missing clientFormats field -> 400', async () => {
    testApp = buildTestApp();
    const id = await registerProject();

    const response = await request(testApp.app).put(`/api/consumers/${id}/formats`).send({});

    expect(response.status).toBe(400);
  });

  it('an unknown consumer id -> 404', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app)
      .put('/api/consumers/does-not-exist/formats')
      .send({ clientFormats: ['cursor'] });

    expect(response.status).toBe(404);
  });
});
