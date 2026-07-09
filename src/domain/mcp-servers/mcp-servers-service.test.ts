import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { runMigrations } from '../../db/migrate.js';
import { openSecret } from '../../vault/secret-vault.js';
import * as assignmentsRepository from '../assignments/assignments-repository.js';
import * as mcpServersRepository from './mcp-servers-repository.js';
import {
  createServer,
  deleteServer,
  listServers,
  updateServer,
  type McpServersServiceDeps,
} from './mcp-servers-service.js';

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

describe('mcp-servers-service', () => {
  let deps: McpServersServiceDeps;

  beforeEach(() => {
    deps = { db: migratedDb(), masterKey: randomBytes(32) };
  });

  it('MCP-01: createServer stdio seals each secret via the vault before persisting', () => {
    createServer(deps, {
      name: 'GitHub',
      kind: 'stdio',
      command: 'npx',
      secrets: [{ envKey: 'GITHUB_TOKEN', value: 'shhh-secret' }],
    });

    const sealed = mcpServersRepository.listSealedSecrets(
      deps.db,
      mcpServersRepository.findByName(deps.db, 'GitHub')!.id,
    );
    expect(sealed[0].ciphertext).not.toBe('shhh-secret');
    expect(openSecret(sealed[0], deps.masterKey)).toBe('shhh-secret');
  });

  it('MCP-01: createServer stdio persists command/args metadata', () => {
    const server = createServer(deps, {
      name: 'GitHub',
      kind: 'stdio',
      command: 'npx',
      args: ['-y', '@github/mcp'],
    });

    expect(server.transport).toBe('stdio');
    expect(server.command).toBe('npx');
    expect(server.args).toEqual(['-y', '@github/mcp']);
  });

  it('MCP-02: createServer remote with url persists transport http by default', () => {
    const server = createServer(deps, { name: 'Remote', kind: 'remote', url: 'https://x.test' });

    expect(server.transport).toBe('http');
    expect(server.url).toBe('https://x.test');
  });

  it('MCP-02: createServer remote with sse flag persists transport sse', () => {
    const server = createServer(deps, {
      name: 'Remote SSE',
      kind: 'remote',
      url: 'https://x.test',
      sse: true,
    });

    expect(server.transport).toBe('sse');
  });

  it('MCP-02: createServer remote does not persist command/args (used only for stdio)', () => {
    const server = createServer(deps, { name: 'Remote', kind: 'remote', url: 'https://x.test' });

    expect(server.command).toBeNull();
    expect(server.args).toBeNull();
  });

  it('MCP-03: throws on a duplicate name and persists nothing', () => {
    createServer(deps, { name: 'GitHub', kind: 'stdio', command: 'npx' });

    expect(() => createServer(deps, { name: 'GitHub', kind: 'stdio', command: 'uvx' })).toThrow();
    expect(listServers(deps)).toHaveLength(1);
  });

  it('MCP-03: throws on a missing name', () => {
    expect(() => createServer(deps, { name: '  ', kind: 'stdio', command: 'npx' })).toThrow();
    expect(listServers(deps)).toHaveLength(0);
  });

  it('MCP-03: throws when stdio is missing a command', () => {
    expect(() => createServer(deps, { name: 'GitHub', kind: 'stdio' })).toThrow();
    expect(listServers(deps)).toHaveLength(0);
  });

  it('MCP-03: throws when remote is missing a url', () => {
    expect(() => createServer(deps, { name: 'Remote', kind: 'remote' })).toThrow();
    expect(listServers(deps)).toHaveLength(0);
  });

  it('SEC-01: listServers never exposes plaintext or ciphertext across multiple servers', () => {
    createServer(deps, {
      name: 'GitHub',
      kind: 'stdio',
      command: 'npx',
      secrets: [{ envKey: 'GITHUB_TOKEN', value: 'secret-a' }],
    });
    createServer(deps, {
      name: 'Slack',
      kind: 'stdio',
      command: 'uvx',
      secrets: [{ envKey: 'SLACK_TOKEN', value: 'secret-b' }],
    });

    const servers = listServers(deps);
    expect(servers).toHaveLength(2);
    expect(servers.every((s) => s.secrets.every((flag) => flag.hasValue === true))).toBe(true);
    expect(JSON.stringify(servers)).not.toContain('secret-a');
    expect(JSON.stringify(servers)).not.toContain('secret-b');
  });

  it('ACC-02: deleteServer removes assignments and invokes the hook once with affected consumer ids', async () => {
    const server = createServer(deps, { name: 'GitHub', kind: 'stdio', command: 'npx' });
    seedConsumer(deps.db, 'consumer-a');
    seedConsumer(deps.db, 'consumer-b');
    assignmentsRepository.assign(deps.db, 'consumer-a', server.id);
    assignmentsRepository.assign(deps.db, 'consumer-b', server.id);

    const hook = vi.fn().mockResolvedValue(undefined);
    await deleteServer(deps, server.id, hook);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0].sort()).toEqual(['consumer-a', 'consumer-b']);
    expect(assignmentsRepository.consumersOfMcp(deps.db, server.id)).toEqual([]);
    expect(mcpServersRepository.getServer(deps.db, server.id)).toBeNull();
  });

  it('ACC-02: deleteServer with zero consumers still succeeds and calls the hook once with an empty array', async () => {
    const server = createServer(deps, { name: 'GitHub', kind: 'stdio', command: 'npx' });

    const hook = vi.fn().mockResolvedValue(undefined);
    await expect(deleteServer(deps, server.id, hook)).resolves.not.toThrow();

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith([]);
  });

  it('updateServer persists a changed field, retrievable afterward', () => {
    const server = createServer(deps, { name: 'GitHub', kind: 'stdio', command: 'npx' });

    const updated = updateServer(deps, server.id, { name: 'GitHub MCP' });

    expect(updated.name).toBe('GitHub MCP');
  });

  it('updateServer rejects a name that collides with a different existing server', () => {
    createServer(deps, { name: 'GitHub', kind: 'stdio', command: 'npx' });
    const other = createServer(deps, { name: 'Slack', kind: 'stdio', command: 'uvx' });

    expect(() => updateServer(deps, other.id, { name: 'GitHub' })).toThrow();
  });
});
