import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { insertConsumer } from '../../src/domain/consumers/consumers-repository.js';
import { assign, allowedMcpIds } from '../../src/domain/assignments/assignments-repository.js';
import { generateId, nowIso } from '../../src/db/repository-helpers.js';
import { MANAGED_KEY } from '../../src/config-writers/managed-block.js';
import { rewriteConfigsForConsumers } from '../../src/config-writers/config-rewrite-service.js';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

function readManagedEntry(configPath: string): unknown {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return (JSON.parse(raw) as { mcpServers?: Record<string, unknown> }).mcpServers?.[MANAGED_KEY];
  } catch {
    return undefined;
  }
}

describe('DELETE /api/mcp-servers/:id', () => {
  let testApp: TestApp | undefined;
  let projectRoot: string;

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('ACC-02: deletes an existing MCP -> 200; server row gone, assignments removed', async () => {
    testApp = buildTestApp();
    projectRoot = mkdtempSync(join(tmpdir(), 'mcp-manager-delete-route-'));
    const projectPath = join(projectRoot, 'project-a');
    mkdirSync(projectPath, { recursive: true });

    const consumer = insertConsumer(testApp.db, {
      id: generateId(),
      type: 'project',
      name: 'project-a',
      path: projectPath,
      token: 'tok-a',
      createdAt: nowIso(),
    });
    const created = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Doomed MCP', kind: 'stdio', command: 'npx' });
    assign(testApp.db, consumer.id, created.body.id);

    const response = await request(testApp.app).delete(`/api/mcp-servers/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(true);

    const getAfterDelete = await request(testApp.app).get(`/api/mcp-servers/${created.body.id}`);
    expect(getAfterDelete.status).toBe(404);
    expect(allowedMcpIds(testApp.db, consumer.id)).toEqual([]);
  });

  it('ACC-02: config rewrite removes the deleted MCP managed entry for each affected project', async () => {
    testApp = buildTestApp();
    projectRoot = mkdtempSync(join(tmpdir(), 'mcp-manager-delete-route-'));
    const projectPath = join(projectRoot, 'project-b');
    mkdirSync(projectPath, { recursive: true });

    const consumer = insertConsumer(testApp.db, {
      id: generateId(),
      type: 'project',
      name: 'project-b',
      path: projectPath,
      token: 'tok-b',
      createdAt: nowIso(),
    });
    const created = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Only MCP', kind: 'stdio', command: 'npx' });
    assign(testApp.db, consumer.id, created.body.id);

    // Simulate a prior "write configs" action so the managed entry already
    // exists on disk before the delete happens.
    await rewriteConfigsForConsumers(
      { db: testApp.db, gatewayBaseUrl: testApp.gatewayBaseUrl },
      [consumer.id],
    );
    const configPath = join(projectPath, '.mcp.json');
    expect(readManagedEntry(configPath)).toBeDefined();

    const response = await request(testApp.app).delete(`/api/mcp-servers/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.configRewrites).toHaveLength(1);
    expect(response.body.configRewrites[0]).toMatchObject({
      consumerId: consumer.id,
      status: 'removed',
    });
    expect(readManagedEntry(configPath)).toBeUndefined();
  });

  it('DELETE unknown id -> 404', async () => {
    testApp = buildTestApp();

    const response = await request(testApp.app).delete('/api/mcp-servers/does-not-exist');

    expect(response.status).toBe(404);
  });

  it('deleting an MCP with zero consumers still succeeds (empty rewrite batch, no error)', async () => {
    testApp = buildTestApp();
    const created = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Lonely MCP', kind: 'stdio', command: 'npx' });

    const response = await request(testApp.app).delete(`/api/mcp-servers/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.configRewrites).toEqual([]);
  });
});
