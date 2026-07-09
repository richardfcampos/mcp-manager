import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { insertConsumer } from '../domain/consumers/consumers-repository.js';
import { insertServer } from '../domain/mcp-servers/mcp-servers-repository.js';
import { assign, unassign } from '../domain/assignments/assignments-repository.js';
import {
  rewriteConfigsForConsumers,
  type ConfigRewriteServiceDeps,
} from './config-rewrite-service.js';
import { writeConfig as writeClaudeCodeConfig } from './claude-code-writer.js';
import { MANAGED_KEY } from './managed-block.js';
import type { ConfigWriter } from './writer-interface.js';

const GATEWAY_BASE_URL = 'http://127.0.0.1:4317';

function migratedDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function seedProjectConsumer(db: Database.Database, id: string, path: string) {
  mkdirSync(path, { recursive: true });
  return insertConsumer(db, {
    id,
    type: 'project',
    name: id,
    path,
    token: `tok-${id}`,
    createdAt: new Date().toISOString(),
  });
}

function seedMcp(db: Database.Database, id: string) {
  insertServer(db, {
    id,
    slug: id,
    name: id,
    transport: 'stdio',
    command: 'npx',
    createdAt: new Date().toISOString(),
    secrets: [],
  });
}

function readManagedEntry(path: string): unknown {
  const config = JSON.parse(readFileSync(join(path, '.mcp.json'), 'utf-8')) as {
    mcpServers: Record<string, unknown>;
  };
  return config.mcpServers[MANAGED_KEY];
}

describe('config-rewrite-service', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mcp-manager-rewrite-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('rewrites configs for all given consumers, each ending up written', async () => {
    const db = migratedDb();
    const pathA = join(root, 'project-a');
    const pathB = join(root, 'project-b');
    seedProjectConsumer(db, 'consumer-a', pathA);
    seedProjectConsumer(db, 'consumer-b', pathB);
    seedMcp(db, 'mcp-1');
    assign(db, 'consumer-a', 'mcp-1');
    assign(db, 'consumer-b', 'mcp-1');

    const deps: ConfigRewriteServiceDeps = { db, gatewayBaseUrl: GATEWAY_BASE_URL };
    const results = await rewriteConfigsForConsumers(deps, ['consumer-a', 'consumer-b']);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'written')).toBe(true);
    expect(readManagedEntry(pathA)).toBeDefined();
    expect(readManagedEntry(pathB)).toBeDefined();
  });

  it('isolates one consumer write throwing so the others still report written', async () => {
    const db = migratedDb();
    const pathA = join(root, 'project-a');
    const pathB = join(root, 'project-b');
    seedProjectConsumer(db, 'consumer-a', pathA);
    seedProjectConsumer(db, 'consumer-b', pathB);
    seedMcp(db, 'mcp-1');
    assign(db, 'consumer-a', 'mcp-1');
    assign(db, 'consumer-b', 'mcp-1');

    const throwingWriter: ConfigWriter = {
      async writeConfig(consumer, gatewayBaseUrl, hasAssignments) {
        if (consumer.id === 'consumer-a') {
          throw new Error('simulated disk failure');
        }
        return writeClaudeCodeConfig(consumer, gatewayBaseUrl, hasAssignments);
      },
    };

    const deps: ConfigRewriteServiceDeps = {
      db,
      gatewayBaseUrl: GATEWAY_BASE_URL,
      writers: { 'claude-code': throwingWriter },
    };
    const results = await rewriteConfigsForConsumers(deps, ['consumer-a', 'consumer-b']);

    const resultA = results.find((r) => r.consumerId === 'consumer-a')!;
    const resultB = results.find((r) => r.consumerId === 'consumer-b')!;
    expect(resultA.status).toBe('error');
    expect(resultA.error).toContain('simulated disk failure');
    expect(resultB.status).toBe('written');
  });

  it('a consumer with 0 assignments reports status removed', async () => {
    const db = migratedDb();
    const path = join(root, 'project-empty');
    seedProjectConsumer(db, 'consumer-empty', path);
    seedMcp(db, 'mcp-1');
    assign(db, 'consumer-empty', 'mcp-1');

    const deps: ConfigRewriteServiceDeps = { db, gatewayBaseUrl: GATEWAY_BASE_URL };
    // First write with an active assignment so the managed entry exists...
    await rewriteConfigsForConsumers(deps, ['consumer-empty']);
    // ...then unassign and rewrite again -- the managed entry must be removed.
    unassign(db, 'consumer-empty', 'mcp-1');

    const results = await rewriteConfigsForConsumers(deps, ['consumer-empty']);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('removed');
  });

  it('the report contains exactly one entry per consumer/format with the correct consumerId', async () => {
    const db = migratedDb();
    const pathA = join(root, 'project-a');
    const pathB = join(root, 'project-b');
    seedProjectConsumer(db, 'consumer-a', pathA);
    seedProjectConsumer(db, 'consumer-b', pathB);
    seedMcp(db, 'mcp-1');
    assign(db, 'consumer-a', 'mcp-1');

    const deps: ConfigRewriteServiceDeps = { db, gatewayBaseUrl: GATEWAY_BASE_URL };
    const results = await rewriteConfigsForConsumers(deps, ['consumer-a', 'consumer-b']);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.consumerId).sort()).toEqual(['consumer-a', 'consumer-b']);
    expect(results.every((r) => r.format === 'claude-code')).toBe(true);
  });

  it('skips consumer ids that no longer exist and skips non-project consumers', async () => {
    const db = migratedDb();
    const desktopPath = join(root, 'desktop-profile');
    mkdirSync(desktopPath, { recursive: true });
    insertConsumer(db, {
      id: 'desktop-1',
      type: 'desktop-profile',
      name: 'desktop-1',
      path: desktopPath,
      token: 'tok-desktop-1',
      createdAt: new Date().toISOString(),
    });

    const deps: ConfigRewriteServiceDeps = { db, gatewayBaseUrl: GATEWAY_BASE_URL };
    const results = await rewriteConfigsForConsumers(deps, ['missing-consumer', 'desktop-1']);

    expect(results).toEqual([]);
  });
});
