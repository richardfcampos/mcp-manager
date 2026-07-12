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

/** Creates a directory that looks like a project root (has a marker file). */
function mkProject(...segments: string[]): string {
  const dir = join(...segments);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{}');
  return dir;
}

/** Creates a plain directory with no project marker (a category or noise). */
function mkPlain(...segments: string[]): string {
  const dir = join(...segments);
  mkdirSync(dir, { recursive: true });
  return dir;
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

  it('PRJ-01: registers a first-level directory that is itself a project, by basename', () => {
    mkProject(root, 'standalone');

    scanWorkspace(deps, root);

    const consumers = listConsumers(deps.db);
    expect(consumers).toHaveLength(1);
    expect(consumers[0].name).toBe('standalone');
    expect(consumers[0].path).toBe(join(root, 'standalone'));
    expect(consumers[0].type === 'project' && consumers[0].discovered).toBe(true);
  });

  it('PRJ-01: descends a category (no marker) and registers each <category>/<project>', () => {
    mkProject(root, 'personal', 'grocify');
    mkProject(root, 'personal', 'stockmate');
    mkProject(root, 'work', 'billing');

    scanWorkspace(deps, root);

    const byName = Object.fromEntries(listConsumers(deps.db).map((c) => [c.name, c.path]));
    expect(Object.keys(byName).sort()).toEqual([
      'personal/grocify',
      'personal/stockmate',
      'work/billing',
    ]);
    expect(byName['personal/grocify']).toBe(join(root, 'personal', 'grocify'));
  });

  it('PRJ-01: a first-level project is NOT descended (its project-like subdirs are ignored)', () => {
    mkProject(root, 'monorepo');
    mkProject(root, 'monorepo', 'packages-app'); // marker inside a project root

    scanWorkspace(deps, root);

    const consumers = listConsumers(deps.db);
    expect(consumers).toHaveLength(1);
    expect(consumers[0].path).toBe(join(root, 'monorepo'));
  });

  it('PRJ-01 edge: a category subdir without a project marker is not registered', () => {
    mkProject(root, 'personal', 'realproj');
    mkPlain(root, 'personal', 'just-a-folder');

    scanWorkspace(deps, root);

    const consumers = listConsumers(deps.db);
    expect(consumers).toHaveLength(1);
    expect(consumers[0].name).toBe('personal/realproj');
  });

  it('PRJ-01 edge: plain files, dot-dirs and node_modules are skipped', () => {
    mkProject(root, 'personal', 'app');
    writeFileSync(join(root, 'readme.txt'), 'hello');
    mkProject(root, '.hidden'); // dot-dir skipped even with a marker
    mkProject(root, 'node_modules'); // skipped even with a marker

    scanWorkspace(deps, root);

    const consumers = listConsumers(deps.db);
    expect(consumers).toHaveLength(1);
    expect(consumers[0].name).toBe('personal/app');
  });

  it('PRJ-03: a vanished project is marked available=false while its assignments remain', () => {
    mkProject(root, 'personal', 'alpha');
    scanWorkspace(deps, root);
    const consumer = getByPath(deps.db, join(root, 'personal', 'alpha'))!;

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

    rmSync(join(root, 'personal', 'alpha'), { recursive: true, force: true });
    scanWorkspace(deps, root);

    expect(getByPath(deps.db, join(root, 'personal', 'alpha'))?.available).toBe(false);
    expect(consumersOfMcp(deps.db, 'mcp-1')).toEqual([consumer.id]);
  });

  it('a project that reappears on a later scan is restored to available=true', () => {
    mkProject(root, 'personal', 'alpha');
    scanWorkspace(deps, root);
    rmSync(join(root, 'personal', 'alpha'), { recursive: true, force: true });
    scanWorkspace(deps, root);
    expect(getByPath(deps.db, join(root, 'personal', 'alpha'))?.available).toBe(false);

    mkProject(root, 'personal', 'alpha');
    const result = scanWorkspace(deps, root);

    expect(getByPath(deps.db, join(root, 'personal', 'alpha'))?.available).toBe(true);
    expect(result.restored).toHaveLength(1);
  });

  it('a repeat scan on an unchanged tree is idempotent (no state change)', () => {
    mkProject(root, 'personal', 'alpha');
    scanWorkspace(deps, root);
    const before = listConsumers(deps.db);

    scanWorkspace(deps, root);
    const after = listConsumers(deps.db);

    expect(after).toEqual(before);
  });

  it('only reconciles discovered consumers scoped to the given root', () => {
    const otherRoot = mkdtempSync(join(tmpdir(), 'mcp-manager-other-root-'));
    try {
      mkProject(otherRoot, 'cat', 'unrelated');
      scanWorkspace(deps, otherRoot);
      expect(getByPath(deps.db, join(otherRoot, 'cat', 'unrelated'))?.available).toBe(true);

      mkProject(root, 'personal', 'alpha');
      scanWorkspace(deps, root);

      // Scanning `root` must not touch the unrelated consumer discovered
      // under a different root, even though it is no longer on disk here.
      expect(getByPath(deps.db, join(otherRoot, 'cat', 'unrelated'))?.available).toBe(true);
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it('returns present/vanished/restored id lists describing the scan outcome', () => {
    mkProject(root, 'personal', 'alpha');
    const first = scanWorkspace(deps, root);
    expect(first.present).toHaveLength(1);
    expect(first.vanished).toEqual([]);
    expect(first.restored).toEqual([]);

    rmSync(join(root, 'personal', 'alpha'), { recursive: true, force: true });
    const second = scanWorkspace(deps, root);
    expect(second.vanished).toHaveLength(1);
  });
});
