import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { runMigrations } from '../../db/migrate.js';
import { insertConsumer } from '../consumers/consumers-repository.js';
import { insertServer } from '../mcp-servers/mcp-servers-repository.js';
import {
  allowedMcpIds,
  assign,
  consumersOfMcp,
  unassign,
  type AssignmentsServiceDeps,
} from './assignments-service.js';

function migratedDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function seedConsumer(db: Database.Database, id: string): void {
  insertConsumer(db, {
    id,
    type: 'project',
    name: id,
    path: `/workspace/${id}`,
    token: `tok-${id}`,
    createdAt: new Date().toISOString(),
  });
}

function seedMcp(db: Database.Database, id: string): void {
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

describe('assignments-service', () => {
  let deps: AssignmentsServiceDeps;

  beforeEach(() => {
    deps = { db: migratedDb() };
  });

  it('ACC-01: persists the assignment when both the consumer and mcp exist', () => {
    seedConsumer(deps.db, 'consumer-1');
    seedMcp(deps.db, 'mcp-1');

    assign(deps, 'consumer-1', 'mcp-1');

    expect(allowedMcpIds(deps, 'consumer-1')).toEqual(['mcp-1']);
  });

  it('ACC-01: throws when the consumer does not exist and persists nothing', () => {
    seedMcp(deps.db, 'mcp-1');

    expect(() => assign(deps, 'missing-consumer', 'mcp-1')).toThrow();
    expect(consumersOfMcp(deps, 'mcp-1')).toEqual([]);
  });

  it('ACC-01: throws when the mcp server does not exist and persists nothing', () => {
    seedConsumer(deps.db, 'consumer-1');

    expect(() => assign(deps, 'consumer-1', 'missing-mcp')).toThrow();
    expect(allowedMcpIds(deps, 'consumer-1')).toEqual([]);
  });

  it('ACC-01: throws when neither the consumer nor the mcp exist', () => {
    expect(() => assign(deps, 'missing-consumer', 'missing-mcp')).toThrow();
  });

  it('ACC-01: unassign removes an existing assignment', () => {
    seedConsumer(deps.db, 'consumer-1');
    seedMcp(deps.db, 'mcp-1');
    assign(deps, 'consumer-1', 'mcp-1');

    unassign(deps, 'consumer-1', 'mcp-1');

    expect(allowedMcpIds(deps, 'consumer-1')).toEqual([]);
  });

  it('ACC-01: unassign on a non-existent assignment does not throw', () => {
    seedConsumer(deps.db, 'consumer-1');
    seedMcp(deps.db, 'mcp-1');

    expect(() => unassign(deps, 'consumer-1', 'mcp-1')).not.toThrow();
  });

  it('allowedMcpIds delegates to the repository unchanged', () => {
    seedConsumer(deps.db, 'consumer-1');
    seedMcp(deps.db, 'mcp-1');
    seedMcp(deps.db, 'mcp-2');
    assign(deps, 'consumer-1', 'mcp-1');
    assign(deps, 'consumer-1', 'mcp-2');

    expect(allowedMcpIds(deps, 'consumer-1').sort()).toEqual(['mcp-1', 'mcp-2']);
  });

  it('consumersOfMcp delegates to the repository unchanged', () => {
    seedConsumer(deps.db, 'consumer-1');
    seedConsumer(deps.db, 'consumer-2');
    seedMcp(deps.db, 'mcp-1');
    assign(deps, 'consumer-1', 'mcp-1');
    assign(deps, 'consumer-2', 'mcp-1');

    expect(consumersOfMcp(deps, 'mcp-1').sort()).toEqual(['consumer-1', 'consumer-2']);
  });
});
