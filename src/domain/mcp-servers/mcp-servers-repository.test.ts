import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { runMigrations } from '../../db/migrate.js';
import {
  deleteServer,
  findByName,
  getServer,
  insertServer,
  listSealedSecrets,
  listServers,
  updateServer,
} from './mcp-servers-repository.js';
import type { InsertServerInput } from './mcp-server-types.js';

/** Fresh in-memory, fully-migrated database per test -- parallel-safe. */
function migratedDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function stdioInput(overrides: Partial<InsertServerInput> = {}): InsertServerInput {
  return {
    id: 'mcp-1',
    slug: 'github',
    name: 'GitHub',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@github/mcp-server'],
    createdAt: new Date().toISOString(),
    secrets: [{ envKey: 'GITHUB_TOKEN', iv: 'iv-1', tag: 'tag-1', ciphertext: 'cipher-1' }],
    ...overrides,
  };
}

describe('mcp-servers-repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = migratedDb();
  });

  it('insertServer persists stdio metadata retrievable via getServer', () => {
    insertServer(db, stdioInput());

    const server = getServer(db, 'mcp-1');
    expect(server?.slug).toBe('github');
    expect(server?.transport).toBe('stdio');
    expect(server?.command).toBe('npx');
    expect(server?.args).toEqual(['-y', '@github/mcp-server']);
  });

  it('persists sealed secret rows keyed by mcpServerId, retrievable via listSealedSecrets', () => {
    insertServer(db, stdioInput());

    const sealed = listSealedSecrets(db, 'mcp-1');
    expect(sealed).toHaveLength(1);
    expect(sealed[0]).toMatchObject({
      envKey: 'GITHUB_TOKEN',
      iv: 'iv-1',
      tag: 'tag-1',
      ciphertext: 'cipher-1',
    });
  });

  it('getServer exposes only hasValue flags, never iv/tag/ciphertext (SEC-01)', () => {
    insertServer(db, stdioInput());

    const server = getServer(db, 'mcp-1');
    expect(server?.secrets).toEqual([{ envKey: 'GITHUB_TOKEN', hasValue: true }]);
    expect(JSON.stringify(server)).not.toContain('cipher-1');
    expect(JSON.stringify(server)).not.toContain('iv-1');
  });

  it('listServers exposes only hasValue flags across multiple servers (SEC-01)', () => {
    insertServer(db, stdioInput());
    insertServer(
      db,
      stdioInput({
        id: 'mcp-2',
        slug: 'slack',
        name: 'Slack',
        secrets: [{ envKey: 'SLACK_TOKEN', iv: 'iv-2', tag: 'tag-2', ciphertext: 'cipher-2' }],
      }),
    );

    const servers = listServers(db);
    expect(servers).toHaveLength(2);
    for (const server of servers) {
      expect(server.secrets.every((s) => typeof s.hasValue === 'boolean')).toBe(true);
    }
    expect(JSON.stringify(servers)).not.toContain('cipher-1');
    expect(JSON.stringify(servers)).not.toContain('cipher-2');
  });

  it('listSealedSecrets returns raw sealed rows for the resolver/decrypt path', () => {
    insertServer(db, stdioInput());

    const sealed = listSealedSecrets(db, 'mcp-1');
    expect(sealed[0].iv).toBe('iv-1');
    expect(sealed[0].tag).toBe('tag-1');
    expect(sealed[0].ciphertext).toBe('cipher-1');
  });

  it('updateServer persists changed fields, retrievable via getServer', () => {
    insertServer(db, stdioInput());

    updateServer(db, 'mcp-1', { name: 'GitHub MCP', command: 'uvx' });

    const server = getServer(db, 'mcp-1');
    expect(server?.name).toBe('GitHub MCP');
    expect(server?.command).toBe('uvx');
  });

  it('updateServer upserts secrets by envKey, preserving untouched keys', () => {
    insertServer(db, stdioInput()); // seeds GITHUB_TOKEN

    updateServer(db, 'mcp-1', {
      secrets: [{ envKey: 'NEW_TOKEN', iv: 'iv-9', tag: 'tag-9', ciphertext: 'cipher-9' }],
    });

    const keys = listSealedSecrets(db, 'mcp-1')
      .map((secret) => secret.envKey)
      .sort();
    expect(keys).toEqual(['GITHUB_TOKEN', 'NEW_TOKEN']);
  });

  it('updateServer replaces the sealed value when an existing envKey is re-provided', () => {
    insertServer(db, stdioInput());

    updateServer(db, 'mcp-1', {
      secrets: [{ envKey: 'GITHUB_TOKEN', iv: 'iv-9', tag: 'tag-9', ciphertext: 'cipher-9' }],
    });

    const sealed = listSealedSecrets(db, 'mcp-1');
    expect(sealed).toHaveLength(1);
    expect(sealed[0].ciphertext).toBe('cipher-9');
  });

  it('updateServer removeSecretKeys deletes only the named keys', () => {
    insertServer(db, stdioInput());
    updateServer(db, 'mcp-1', {
      secrets: [{ envKey: 'OTHER_TOKEN', iv: 'iv-2', tag: 'tag-2', ciphertext: 'cipher-2' }],
    });

    updateServer(db, 'mcp-1', { removeSecretKeys: ['GITHUB_TOKEN'] });

    const keys = listSealedSecrets(db, 'mcp-1').map((secret) => secret.envKey);
    expect(keys).toEqual(['OTHER_TOKEN']);
  });

  it('deleteServer removes the server row and all its secret rows', () => {
    insertServer(db, stdioInput());

    deleteServer(db, 'mcp-1');

    expect(getServer(db, 'mcp-1')).toBeNull();
    expect(listSealedSecrets(db, 'mcp-1')).toHaveLength(0);
  });

  it('findByName returns the server record when the name exists, null otherwise', () => {
    insertServer(db, stdioInput());

    expect(findByName(db, 'GitHub')?.id).toBe('mcp-1');
    expect(findByName(db, 'Nonexistent')).toBeNull();
  });

  it('getServer and listServers return null/empty for no matching data', () => {
    expect(getServer(db, 'missing')).toBeNull();
    expect(listServers(db)).toEqual([]);
  });
});
