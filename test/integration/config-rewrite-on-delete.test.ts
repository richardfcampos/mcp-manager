import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { insertConsumer } from '../../src/domain/consumers/consumers-repository.js';
import { allowedMcpIds, assign } from '../../src/domain/assignments/assignments-repository.js';
import {
  createServer,
  deleteServerAndRewriteConfigs,
  type DeleteServerWithConfigRewriteDeps,
} from '../../src/domain/mcp-servers/mcp-servers-service.js';
import { rewriteConfigsForConsumers } from '../../src/config-writers/config-rewrite-service.js';
import { MANAGED_KEY } from '../../src/config-writers/managed-block.js';

const GATEWAY_BASE_URL = 'http://127.0.0.1:4317';

function migratedDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function readManagedEntry(projectPath: string): unknown {
  const config = JSON.parse(readFileSync(join(projectPath, '.mcp.json'), 'utf-8')) as {
    mcpServers: Record<string, unknown>;
  };
  return config.mcpServers[MANAGED_KEY];
}

describe('config-rewrite-on-delete (ACC-02 end-to-end)', () => {
  let root: string;
  let deps: DeleteServerWithConfigRewriteDeps;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mcp-manager-delete-rewrite-'));
    deps = { db: migratedDb(), masterKey: randomBytes(32), gatewayBaseUrl: GATEWAY_BASE_URL };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('deleting the only assigned MCP leaves the project with 0 assignments and removes the managed entry', async () => {
    const projectPath = join(root, 'project-solo');
    mkdirSync(projectPath, { recursive: true });
    const consumer = insertConsumer(deps.db, {
      id: 'consumer-solo',
      type: 'project',
      name: 'project-solo',
      path: projectPath,
      token: 'tok-solo',
      createdAt: new Date().toISOString(),
    });
    const server = createServer(deps, { name: 'Solo MCP', kind: 'stdio', command: 'npx' });
    assign(deps.db, consumer.id, server.id);

    // Simulate a prior "write configs" action so the managed entry already
    // exists on disk before the delete happens.
    await rewriteConfigsForConsumers({ db: deps.db, gatewayBaseUrl: GATEWAY_BASE_URL }, [
      consumer.id,
    ]);
    expect(readManagedEntry(projectPath)).toBeDefined();

    const results = await deleteServerAndRewriteConfigs(deps, server.id);

    expect(allowedMcpIds(deps.db, consumer.id)).toEqual([]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ consumerId: consumer.id, status: 'removed' });
    expect(readManagedEntry(projectPath)).toBeUndefined();
  });

  it('deleting one of two assigned MCPs keeps the project scoped to the remaining MCP and retains the managed entry', async () => {
    const projectPath = join(root, 'project-multi');
    mkdirSync(projectPath, { recursive: true });
    const consumer = insertConsumer(deps.db, {
      id: 'consumer-multi',
      type: 'project',
      name: 'project-multi',
      path: projectPath,
      token: 'tok-multi',
      createdAt: new Date().toISOString(),
    });
    const serverToDelete = createServer(deps, { name: 'Delete Me', kind: 'stdio', command: 'npx' });
    const serverToKeep = createServer(deps, { name: 'Keep Me', kind: 'stdio', command: 'uvx' });
    assign(deps.db, consumer.id, serverToDelete.id);
    assign(deps.db, consumer.id, serverToKeep.id);

    await rewriteConfigsForConsumers({ db: deps.db, gatewayBaseUrl: GATEWAY_BASE_URL }, [
      consumer.id,
    ]);
    expect(readManagedEntry(projectPath)).toBeDefined();

    const results = await deleteServerAndRewriteConfigs(deps, serverToDelete.id);

    expect(allowedMcpIds(deps.db, consumer.id)).toEqual([serverToKeep.id]);
    expect(results).toHaveLength(1);
    // The gateway aggregates ALL assigned MCPs behind ONE entry keyed only
    // by the consumer's token -- deleting one of two assigned MCPs doesn't
    // change which URL the project's config points at, so the on-disk
    // content is byte-identical and the writer correctly reports
    // 'unchanged' (idempotent) rather than rewriting the file. The scoping
    // to the one remaining MCP happens server-side in the gateway, not in
    // the written file.
    expect(results[0]).toMatchObject({ consumerId: consumer.id, status: 'unchanged' });
    expect(readManagedEntry(projectPath)).toEqual({
      type: 'http',
      url: `${GATEWAY_BASE_URL}/mcp/tok-multi`,
      headers: { Authorization: 'Bearer tok-multi' },
    });
  });
});
