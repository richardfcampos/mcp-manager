import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { runMigrations } from '../../db/migrate.js';
import {
  allowedMcpIds,
  assign,
  consumersOfMcp,
  deleteByConsumerId,
  deleteByMcpId,
  unassign,
} from './assignments-repository.js';

function migratedDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function seedConsumer(db: Database.Database, id: string): void {
  db.prepare(
    'INSERT INTO consumer (id, type, name, path, token, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, 'project', id, `/workspace/${id}`, `tok-${id}`, new Date().toISOString());
}

function seedMcp(db: Database.Database, id: string): void {
  db.prepare(
    'INSERT INTO mcp_server (id, slug, name, transport, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, id, id, 'stdio', new Date().toISOString());
}

function countAssignments(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM assignment').get() as { n: number }).n;
}

describe('assignments-repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = migratedDb();
    seedConsumer(db, 'consumer-a');
    seedConsumer(db, 'consumer-b');
    seedMcp(db, 'mcp-x');
    seedMcp(db, 'mcp-y');
  });

  it('assign persists a row reflected in allowedMcpIds', () => {
    assign(db, 'consumer-a', 'mcp-x');

    expect(allowedMcpIds(db, 'consumer-a')).toEqual(['mcp-x']);
  });

  it('unassign removes the assignment', () => {
    assign(db, 'consumer-a', 'mcp-x');

    unassign(db, 'consumer-a', 'mcp-x');

    expect(allowedMcpIds(db, 'consumer-a')).toEqual([]);
  });

  it('a duplicate (consumerId, mcpServerId) pair does not create a second row', () => {
    assign(db, 'consumer-a', 'mcp-x');
    assign(db, 'consumer-a', 'mcp-x');

    expect(countAssignments(db)).toBe(1);
  });

  it('allowedMcpIds returns only that consumer assigned mcpServerIds', () => {
    assign(db, 'consumer-a', 'mcp-x');
    assign(db, 'consumer-b', 'mcp-y');

    expect(allowedMcpIds(db, 'consumer-a')).toEqual(['mcp-x']);
  });

  it('consumersOfMcp returns only consumers assigned to that mcp', () => {
    assign(db, 'consumer-a', 'mcp-x');
    assign(db, 'consumer-b', 'mcp-x');
    assign(db, 'consumer-b', 'mcp-y');

    expect(consumersOfMcp(db, 'mcp-x').sort()).toEqual(['consumer-a', 'consumer-b']);
    expect(consumersOfMcp(db, 'mcp-y')).toEqual(['consumer-b']);
  });

  it('deleteByMcpId removes every assignment row for the given mcpServerId', () => {
    assign(db, 'consumer-a', 'mcp-x');
    assign(db, 'consumer-b', 'mcp-x');
    assign(db, 'consumer-b', 'mcp-y');

    deleteByMcpId(db, 'mcp-x');

    expect(consumersOfMcp(db, 'mcp-x')).toEqual([]);
    expect(allowedMcpIds(db, 'consumer-b')).toEqual(['mcp-y']);
  });

  it('deleteByConsumerId removes every assignment row for the given consumerId', () => {
    assign(db, 'consumer-a', 'mcp-x');
    assign(db, 'consumer-a', 'mcp-y');
    assign(db, 'consumer-b', 'mcp-x');

    deleteByConsumerId(db, 'consumer-a');

    expect(allowedMcpIds(db, 'consumer-a')).toEqual([]);
    expect(consumersOfMcp(db, 'mcp-x')).toEqual(['consumer-b']);
  });

  it('unassign on a non-existent pair does not throw', () => {
    expect(() => unassign(db, 'consumer-a', 'mcp-x')).not.toThrow();
  });

  it('allowedMcpIds and consumersOfMcp return empty arrays when none exist', () => {
    expect(allowedMcpIds(db, 'consumer-a')).toEqual([]);
    expect(consumersOfMcp(db, 'mcp-x')).toEqual([]);
  });
});
