import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

describe('GET /api/health', () => {
  let testApp: TestApp | undefined;

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
  });

  it('returns 200 {status: ok} from the real create-app-assembled application', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
