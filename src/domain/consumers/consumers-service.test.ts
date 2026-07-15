import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { runMigrations } from '../../db/migrate.js';
import {
  getByToken,
  listConsumers,
  registerDesktopProfile,
  registerManualProject,
  rotateToken,
  setClientFormats,
  type ConsumersServiceDeps,
} from './consumers-service.js';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function migratedDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

describe('consumers-service', () => {
  let deps: ConsumersServiceDeps;
  let tempDirs: string[];

  beforeEach(() => {
    deps = { db: migratedDb() };
    tempDirs = [];
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-manager-consumer-'));
    tempDirs.push(dir);
    return dir;
  }

  it('PRJ-02: registers a manual project at an existing writable path with a base64url token', () => {
    const dir = makeTempDir();

    const consumer = registerManualProject(deps, dir, 'My Project');

    expect(consumer.type).toBe('project');
    expect(consumer.discovered).toBe(false);
    expect(consumer.available).toBe(true);
    expect(consumer.token).toMatch(BASE64URL_PATTERN);
  });

  it('derives the consumer name from the path basename when not provided', () => {
    const dir = makeTempDir();

    const consumer = registerManualProject(deps, dir);

    expect(consumer.name).toBe(dir.split('/').pop());
  });

  it('PRJ-03: rejects a nonexistent path and persists nothing', () => {
    expect(() => registerManualProject(deps, '/no/such/path/exists')).toThrow();
    expect(listConsumers(deps)).toHaveLength(0);
  });

  it('PRJ-03: rejects a non-writable path and persists nothing', () => {
    const dir = makeTempDir();
    chmodSync(dir, 0o500);

    expect(() => registerManualProject(deps, dir)).toThrow();
    expect(listConsumers(deps)).toHaveLength(0);
  });

  it('rotateToken replaces the token with a new distinct base64url value', () => {
    const dir = makeTempDir();
    const consumer = registerManualProject(deps, dir);
    const previousToken = consumer.token;

    const newToken = rotateToken(deps, consumer.id);

    expect(newToken).toMatch(BASE64URL_PATTERN);
    expect(newToken).not.toBe(previousToken);
    expect(getByToken(deps, newToken)?.id).toBe(consumer.id);
    expect(getByToken(deps, previousToken)).toBeNull();
  });

  it('setClientFormats persists exactly the provided array', () => {
    const dir = makeTempDir();
    const consumer = registerManualProject(deps, dir);

    setClientFormats(deps, consumer.id, ['cursor', 'vscode']);

    expect(listConsumers(deps)[0].clientFormats).toEqual(['cursor', 'vscode']);
  });

  it('getByToken delegates to the repository and returns the matching consumer', () => {
    const dir = makeTempDir();
    const consumer = registerManualProject(deps, dir);

    expect(getByToken(deps, consumer.token)?.id).toBe(consumer.id);
  });

  it('getByToken returns null when no consumer holds the token', () => {
    expect(getByToken(deps, 'unknown-token')).toBeNull();
  });

  it('listConsumers returns every registered consumer', () => {
    registerManualProject(deps, makeTempDir());
    registerManualProject(deps, makeTempDir());

    expect(listConsumers(deps)).toHaveLength(2);
  });

  it('registerDesktopProfile persists a desktop-profile consumer', () => {
    const dir = makeTempDir();

    const consumer = registerDesktopProfile(deps, dir, 'Claude Desktop');

    expect(consumer.type).toBe('desktop-profile');
    expect(consumer.name).toBe('Claude Desktop');
  });
});
