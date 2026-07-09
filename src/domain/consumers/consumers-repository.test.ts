import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { runMigrations } from '../../db/migrate.js';
import {
  deleteConsumer,
  getByPath,
  getByToken,
  getConsumer,
  insertConsumer,
  listConsumers,
  setAvailable,
  updateClientFormats,
  updateToken,
  upsertDiscovered,
} from './consumers-repository.js';
import type { InsertConsumerInput } from './consumer-types.js';

function migratedDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function projectInput(overrides: Partial<InsertConsumerInput> = {}): InsertConsumerInput {
  return {
    id: 'consumer-1',
    type: 'project',
    name: 'demo',
    path: '/workspace/demo',
    token: 'tok-1',
    clientFormats: ['claude-code'],
    discovered: false,
    available: true,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('consumers-repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = migratedDb();
  });

  it('insertConsumer + getConsumer round-trip every field', () => {
    insertConsumer(db, projectInput());

    const consumer = getConsumer(db, 'consumer-1');
    expect(consumer).toMatchObject({
      id: 'consumer-1',
      type: 'project',
      name: 'demo',
      path: '/workspace/demo',
      token: 'tok-1',
      clientFormats: ['claude-code'],
      discovered: false,
      available: true,
      enabled: true,
    });
  });

  it('getConsumer returns null for an unknown id', () => {
    expect(getConsumer(db, 'missing')).toBeNull();
  });

  it('getByPath returns the consumer matching the path, null otherwise', () => {
    insertConsumer(db, projectInput());

    expect(getByPath(db, '/workspace/demo')?.id).toBe('consumer-1');
    expect(getByPath(db, '/workspace/nope')).toBeNull();
  });

  it('getByToken returns the consumer holding the token', () => {
    insertConsumer(db, projectInput());

    expect(getByToken(db, 'tok-1')?.id).toBe('consumer-1');
  });

  it('getByToken returns null when no consumer holds the token', () => {
    expect(getByToken(db, 'unknown-token')).toBeNull();
  });

  it('listConsumers returns every inserted consumer', () => {
    insertConsumer(db, projectInput());
    insertConsumer(db, projectInput({ id: 'consumer-2', path: '/workspace/other', token: 'tok-2' }));

    expect(listConsumers(db)).toHaveLength(2);
  });

  it('updateToken replaces the token value', () => {
    insertConsumer(db, projectInput());

    updateToken(db, 'consumer-1', 'tok-rotated');

    expect(getByToken(db, 'tok-rotated')?.id).toBe('consumer-1');
    expect(getByToken(db, 'tok-1')).toBeNull();
  });

  it('updateClientFormats persists exactly the provided array', () => {
    insertConsumer(db, projectInput());

    updateClientFormats(db, 'consumer-1', ['cursor', 'vscode']);

    expect(getConsumer(db, 'consumer-1')?.clientFormats).toEqual(['cursor', 'vscode']);
  });

  it('setAvailable flips the available flag', () => {
    insertConsumer(db, projectInput({ available: true }));

    setAvailable(db, 'consumer-1', false);
    expect(getConsumer(db, 'consumer-1')?.available).toBe(false);

    setAvailable(db, 'consumer-1', true);
    expect(getConsumer(db, 'consumer-1')?.available).toBe(true);
  });

  it('upsertDiscovered inserts a new discovered project consumer once', () => {
    const consumer = upsertDiscovered(db, {
      path: '/workspace/auto',
      name: 'auto',
      createdAt: new Date().toISOString(),
    });

    expect(consumer.type).toBe('project');
    expect(consumer.discovered).toBe(true);
    expect(consumer.available).toBe(true);
    expect(listConsumers(db)).toHaveLength(1);
  });

  it('upsertDiscovered is idempotent on repeated calls with the same path', () => {
    const first = upsertDiscovered(db, {
      path: '/workspace/auto',
      name: 'auto',
      createdAt: new Date().toISOString(),
    });
    const second = upsertDiscovered(db, {
      path: '/workspace/auto',
      name: 'auto',
      createdAt: new Date().toISOString(),
    });

    expect(second.id).toBe(first.id);
    expect(listConsumers(db)).toHaveLength(1);
  });

  it('deleteConsumer removes the row', () => {
    insertConsumer(db, projectInput());

    deleteConsumer(db, 'consumer-1');

    expect(getConsumer(db, 'consumer-1')).toBeNull();
  });
});
