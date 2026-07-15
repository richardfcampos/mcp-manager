import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { insertConsumer } from '../../src/domain/consumers/consumers-repository.js';
import { assign, allowedMcpIds } from '../../src/domain/assignments/assignments-repository.js';
import { generateId, nowIso } from '../../src/db/repository-helpers.js';
import { buildTestApp, type TestApp } from './helpers/build-test-app.js';

/** Creates a directory scanWorkspace recognizes as a project root (discovery
 * is marker-based: it keys off a project file such as package.json). */
function mkProjectDir(path: string): string {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'package.json'), '{}');
  return path;
}

describe('GET /api/consumers, POST /api/consumers/discover', () => {
  let testApp: TestApp | undefined;
  let workspaceRoot: string;

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
    if (workspaceRoot) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('PRJ-01: POST discover lists each project root under the mounted root as a discovered project', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'mcp-manager-discover-'));
    mkProjectDir(join(workspaceRoot, 'project-alpha'));
    mkProjectDir(join(workspaceRoot, 'project-beta'));
    testApp = buildTestApp({ workspaceRoot });

    const response = await request(testApp.app).post('/api/consumers/discover');

    expect(response.status).toBe(200);
    expect(response.body.present).toHaveLength(2);

    const list = await request(testApp.app).get('/api/consumers');
    const names = (list.body as Array<{ name: string; discovered: boolean }>)
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(['project-alpha', 'project-beta']);
    expect(list.body.every((c: { discovered: boolean }) => c.discovered)).toBe(true);
  });

  it('GET list returns both discovered and manually-registered consumers', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'mcp-manager-discover-'));
    mkProjectDir(join(workspaceRoot, 'auto-project'));
    testApp = buildTestApp({ workspaceRoot });
    await request(testApp.app).post('/api/consumers/discover');

    insertConsumer(testApp.db, {
      id: generateId(),
      type: 'project',
      name: 'manual-project',
      path: mkdtempSync(join(tmpdir(), 'mcp-manager-manual-')),
      token: 'manual-token',
      discovered: false,
      createdAt: nowIso(),
    });

    const response = await request(testApp.app).get('/api/consumers');

    const names = (response.body as Array<{ name: string }>).map((c) => c.name).sort();
    expect(names).toEqual(['auto-project', 'manual-project']);
  });

  it('PRJ-03: a previously-discovered folder now missing -> available=false, its assignment rows preserved', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'mcp-manager-discover-'));
    const vanishingPath = join(workspaceRoot, 'vanishing-project');
    mkProjectDir(vanishingPath);
    testApp = buildTestApp({ workspaceRoot });
    await request(testApp.app).post('/api/consumers/discover');

    const mcpServer = await request(testApp.app)
      .post('/api/mcp-servers')
      .send({ name: 'Kept MCP', kind: 'stdio', command: 'npx' });
    const before = await request(testApp.app).get('/api/consumers');
    const vanishingConsumer = (
      before.body as Array<{ id: string; name: string }>
    ).find((c) => c.name === 'vanishing-project')!;
    assign(testApp.db, vanishingConsumer.id, mcpServer.body.id);

    rmSync(vanishingPath, { recursive: true, force: true });
    const rescan = await request(testApp.app).post('/api/consumers/discover');

    expect(rescan.body.vanished).toEqual([vanishingConsumer.id]);
    const after = await request(testApp.app).get('/api/consumers');
    const updated = (after.body as Array<{ id: string; available: boolean }>).find(
      (c) => c.id === vanishingConsumer.id,
    )!;
    expect(updated.available).toBe(false);
    expect(allowedMcpIds(testApp.db, vanishingConsumer.id)).toEqual([mcpServer.body.id]);
  });

  it('a repeat scan of an unchanged tree is idempotent (no vanished/restored, present unchanged)', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'mcp-manager-discover-'));
    mkProjectDir(join(workspaceRoot, 'stable-project'));
    testApp = buildTestApp({ workspaceRoot });

    const first = await request(testApp.app).post('/api/consumers/discover');
    const second = await request(testApp.app).post('/api/consumers/discover');

    expect(second.body.present).toEqual(first.body.present);
    expect(second.body.vanished).toEqual([]);
    expect(second.body.restored).toEqual([]);
  });
});
