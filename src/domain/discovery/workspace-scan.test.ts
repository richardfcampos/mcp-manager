import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { runMigrations } from '../../db/migrate.js';
import { getByPath, listConsumers } from '../consumers/consumers-repository.js';
import { insertServer } from '../mcp-servers/mcp-servers-repository.js';
import { assign, consumersOfMcp } from '../assignments/assignments-repository.js';
import { scanWorkspace, type WorkspaceScanDeps } from './workspace-scan.js';

function migratedDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

describe('scanWorkspace', () => {
  let deps: WorkspaceScanDeps;
  let root: string;

  beforeEach(() => {
    deps = { db: migratedDb() };
    root = mkdtempSync(join(tmpdir(), 'mcp-manager-workspace-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('PRJ-01: upserts exactly one project consumer per immediate subdirectory', () => {
    mkdirSync(join(root, 'alpha'));
    mkdirSync(join(root, 'beta'));
    mkdirSync(join(root, 'gamma'));

    scanWorkspace(deps, root);

    const consumers = listConsumers(deps.db);
    expect(consumers).toHaveLength(3);
    expect(consumers.every((c) => c.type === 'project' && c.discovered)).toBe(true);
  });

  it('PRJ-01 edge: plain files at the root are not registered as consumers', () => {
    mkdirSync(join(root, 'alpha'));
    writeFileSync(join(root, 'readme.txt'), 'hello');

    scanWorkspace(deps, root);

    expect(listConsumers(deps.db)).toHaveLength(1);
  });

  it('PRJ-01 edge: second-level nested directories are not registered', () => {
    mkdirSync(join(root, 'alpha', 'nested'), { recursive: true });

    scanWorkspace(deps, root);

    const consumers = listConsumers(deps.db);
    expect(consumers).toHaveLength(1);
    expect(consumers[0].path).toBe(join(root, 'alpha'));
  });

  it('PRJ-03: a vanished folder is marked available=false while its assignments remain', () => {
    mkdirSync(join(root, 'alpha'));
    scanWorkspace(deps, root);
    const consumer = getByPath(deps.db, join(root, 'alpha'))!;

    insertServer(deps.db, {
      id: 'mcp-1',
      slug: 'mcp-1',
      name: 'mcp-1',
      transport: 'stdio',
      command: 'npx',
      createdAt: new Date().toISOString(),
      secrets: [],
    });
    assign(deps.db, consumer.id, 'mcp-1');

    rmSync(join(root, 'alpha'), { recursive: true, force: true });
    scanWorkspace(deps, root);

    expect(getByPath(deps.db, join(root, 'alpha'))?.available).toBe(false);
    expect(consumersOfMcp(deps.db, 'mcp-1')).toEqual([consumer.id]);
  });

  it('a folder that reappears on a later scan is restored to available=true', () => {
    mkdirSync(join(root, 'alpha'));
    scanWorkspace(deps, root);
    rmSync(join(root, 'alpha'), { recursive: true, force: true });
    scanWorkspace(deps, root);
    expect(getByPath(deps.db, join(root, 'alpha'))?.available).toBe(false);

    mkdirSync(join(root, 'alpha'));
    const result = scanWorkspace(deps, root);

    expect(getByPath(deps.db, join(root, 'alpha'))?.available).toBe(true);
    expect(result.restored).toHaveLength(1);
  });

  it('a repeat scan on an unchanged tree is idempotent (no state change)', () => {
    mkdirSync(join(root, 'alpha'));
    scanWorkspace(deps, root);
    const before = listConsumers(deps.db);

    scanWorkspace(deps, root);
    const after = listConsumers(deps.db);

    expect(after).toEqual(before);
  });

  it('only reconciles discovered consumers scoped to the given root', () => {
    const otherRoot = mkdtempSync(join(tmpdir(), 'mcp-manager-other-root-'));
    try {
      mkdirSync(join(otherRoot, 'unrelated'));
      scanWorkspace(deps, otherRoot);
      expect(getByPath(deps.db, join(otherRoot, 'unrelated'))?.available).toBe(true);

      mkdirSync(join(root, 'alpha'));
      scanWorkspace(deps, root);

      // Scanning `root` must not touch the unrelated consumer discovered
      // under a different root, even though it is no longer on disk here.
      expect(getByPath(deps.db, join(otherRoot, 'unrelated'))?.available).toBe(true);
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it('returns present/vanished/restored id lists describing the scan outcome', () => {
    mkdirSync(join(root, 'alpha'));
    const first = scanWorkspace(deps, root);
    expect(first.present).toHaveLength(1);
    expect(first.vanished).toEqual([]);
    expect(first.restored).toEqual([]);

    rmSync(join(root, 'alpha'), { recursive: true, force: true });
    const second = scanWorkspace(deps, root);
    expect(second.vanished).toHaveLength(1);
  });
});
