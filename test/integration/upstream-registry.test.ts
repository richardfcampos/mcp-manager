import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import * as mcpServersRepository from '../../src/domain/mcp-servers/mcp-servers-repository.js';
import { generateId, nowIso } from '../../src/db/repository-helpers.js';
import { sealSecret } from '../../src/vault/secret-vault.js';
import { UpstreamRegistry } from '../../src/gateway/upstream-registry.js';
import { start as startDummyRemote, type DummyRemoteMcpHandle } from '../fixtures/dummy-remote-mcp.js';

const FIXTURE_STDIO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/dummy-stdio-mcp.ts',
);
const MASTER_KEY = Buffer.alloc(32, 9);

function migratedDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function insertStdioServer(db: Database.Database, slug: string, secretValue?: string): string {
  const id = generateId();
  const secrets = secretValue
    ? [{ envKey: 'FIXTURE_SECRET', ...sealSecret(secretValue, MASTER_KEY) }]
    : [];
  mcpServersRepository.insertServer(db, {
    id,
    slug,
    name: slug,
    transport: 'stdio',
    command: process.execPath,
    args: [FIXTURE_STDIO_PATH],
    url: null,
    headers: null,
    createdAt: nowIso(),
    secrets,
  });
  return id;
}

function insertRemoteServer(db: Database.Database, slug: string, url: string): string {
  const id = generateId();
  mcpServersRepository.insertServer(db, {
    id,
    slug,
    name: slug,
    transport: 'http',
    command: null,
    args: null,
    url,
    headers: null,
    createdAt: nowIso(),
    secrets: [],
  });
  return id;
}

describe('upstream-registry', () => {
  let db: Database.Database;
  let registry: UpstreamRegistry;
  let remoteHandles: DummyRemoteMcpHandle[];

  beforeEach(() => {
    db = migratedDb();
    registry = new UpstreamRegistry({ db, masterKey: MASTER_KEY });
    remoteHandles = [];
  });

  afterEach(async () => {
    await registry.shutdown('all');
    await Promise.all(remoteHandles.map((handle) => handle.close()));
    db.close();
  });

  it('caches the connected client: a second getClient reuses it (no second spawn)', async () => {
    const id = insertStdioServer(db, 'cached-mcp');

    const first = await registry.getClient(id);
    const second = await registry.getClient(id);

    expect(second.client).toBe(first.client);
    expect(second.mcpServer).toEqual({ id, slug: 'cached-mcp', transport: 'stdio' });
  });

  it('GW-02: status transitions to running after a successful connect', async () => {
    const id = insertStdioServer(db, 'status-mcp');
    expect(registry.status(id)).toBe('stopped');

    await registry.getClient(id);

    expect(registry.status(id)).toBe('running');
  });

  it('GW-02: a stdio upstream connected through the registry receives its decrypted secret in the child env', async () => {
    const id = insertStdioServer(db, 'secret-mcp', 'registry-secret-value');

    const { client } = await registry.getClient(id);
    const result = await client.callTool({ name: 'read-secret', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;

    expect(content[0]).toMatchObject({ type: 'text', text: 'registry-secret-value' });
  });

  it('GW-03: a failing upstream is marked error and reported unavailable without blocking a healthy one', async () => {
    const brokenRemote = await startDummyRemote({ failMode: true });
    remoteHandles.push(brokenRemote);
    const brokenId = insertRemoteServer(db, 'broken-mcp', brokenRemote.url);
    const healthyId = insertStdioServer(db, 'healthy-mcp');

    await expect(registry.getClient(brokenId)).rejects.toThrow();
    expect(registry.status(brokenId)).toBe('error');

    const healthy = await registry.getClient(healthyId);
    expect(registry.status(healthyId)).toBe('running');
    expect(healthy.mcpServer.slug).toBe('healthy-mcp');
  });

  it('restart re-establishes the connection after shutdown', async () => {
    const id = insertStdioServer(db, 'restart-mcp');
    await registry.getClient(id);

    await registry.shutdown(id);
    expect(registry.status(id)).toBe('stopped');

    const restarted = await registry.restart(id);
    expect(registry.status(id)).toBe('running');
    expect(restarted.mcpServer.slug).toBe('restart-mcp');
  });
});
