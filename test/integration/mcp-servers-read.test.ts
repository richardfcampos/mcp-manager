import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

describe('GET /api/mcp-servers, GET /api/mcp-servers/:id', () => {
  let testApp: TestApp | undefined;

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
  });

  it('SEC-01: GET list returns an array; each secret is {envKey, hasValue:true} with no iv/tag/ciphertext/plaintext', async () => {
    testApp = buildTestApp();
    await request(testApp.app)
      .post('/api/mcp-servers')
      .send({
        name: 'Listed One',
        kind: 'stdio',
        command: 'npx',
        secrets: [{ envKey: 'API_KEY', value: 'top-secret-value' }],
      });

    const response = await request(testApp.app).get('/api/mcp-servers');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].secrets).toEqual([{ envKey: 'API_KEY', hasValue: true }]);
    const bodyText = JSON.stringify(response.body);
    expect(bodyText).not.toContain('top-secret-value');
    expect(bodyText).not.toMatch(/"iv"|"tag"|"ciphertext"/);
  });

  it('SEC-01: GET :id returns a single server with the same no-plaintext guarantee', async () => {
    testApp = buildTestApp();
    const created = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({
        name: 'Detail One',
        kind: 'stdio',
        command: 'npx',
        secrets: [{ envKey: 'TOKEN', value: 'another-secret-value' }],
      });

    const response = await request(testApp.app).get(`/api/mcp-servers/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(created.body.id);
    expect(response.body.secrets).toEqual([{ envKey: 'TOKEN', hasValue: true }]);
    expect(JSON.stringify(response.body)).not.toContain('another-secret-value');
  });

  it('GET :id unknown -> 404', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app).get('/api/mcp-servers/does-not-exist');

    expect(response.status).toBe(404);
  });
});
