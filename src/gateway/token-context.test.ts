import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { generateId, nowIso } from '../db/repository-helpers.js';
import * as assignmentsRepository from '../domain/assignments/assignments-repository.js';
import * as consumersRepository from '../domain/consumers/consumers-repository.js';
import * as mcpServersRepository from '../domain/mcp-servers/mcp-servers-repository.js';
import { createTokenContext, type GatewayRequest, type TokenContextDeps } from './token-context.js';

function migratedDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function insertConsumer(db: Database.Database, token: string, enabled = true): string {
  const id = generateId();
  consumersRepository.insertConsumer(db, {
    id,
    type: 'project',
    name: 'test-consumer',
    path: '/tmp/test-consumer',
    token,
    clientFormats: [],
    discovered: false,
    available: true,
    enabled,
    createdAt: nowIso(),
  });
  return id;
}

function insertMcpServer(db: Database.Database, slug: string): string {
  const id = generateId();
  mcpServersRepository.insertServer(db, {
    id,
    slug,
    name: slug,
    transport: 'stdio',
    command: 'node',
    args: [],
    url: null,
    headers: null,
    createdAt: nowIso(),
    secrets: [],
  });
  return id;
}

/** Minimal Express req/res doubles -- the middleware only reads
 * req.params.token and calls res.status().json() or next(), so a full
 * Express app isn't needed for these unit tests. */
function fakeReqRes(token: string) {
  const req = { params: { token } } as unknown as GatewayRequest;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as unknown as Parameters<ReturnType<typeof createTokenContext>>[1];
  const next = vi.fn();
  return { req, res, next, json, status };
}

describe('token-context middleware', () => {
  let db: Database.Database;
  let deps: TokenContextDeps;

  beforeEach(() => {
    db = migratedDb();
    deps = { db };
  });

  it('valid token: attaches req.consumer + req.allowedMcpIds and calls next()', () => {
    const mcpId = insertMcpServer(db, 'demo-mcp');
    const consumerId = insertConsumer(db, 'valid-token');
    assignmentsRepository.assign(db, consumerId, mcpId);

    const { req, res, next, status } = fakeReqRes('valid-token');
    createTokenContext(deps)(req, res, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.consumer?.id).toBe(consumerId);
    expect(req.allowedMcpIds).toEqual([mcpId]);
  });

  it('SEC-02: unknown token -> 401, next() not called, no scope attached', () => {
    const { req, res, next, status, json } = fakeReqRes('no-such-token');
    createTokenContext(deps)(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(req.consumer).toBeUndefined();
    expect(req.allowedMcpIds).toBeUndefined();
  });

  it('SEC-02: disabled consumer token -> 401', () => {
    insertConsumer(db, 'disabled-token', false);

    const { req, res, next, status } = fakeReqRes('disabled-token');
    createTokenContext(deps)(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('a consumer with zero assignments gets an empty allowedMcpIds and next() is still called', () => {
    insertConsumer(db, 'no-assignments-token');

    const { req, res, next, status } = fakeReqRes('no-assignments-token');
    createTokenContext(deps)(req, res, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.allowedMcpIds).toEqual([]);
  });
});
