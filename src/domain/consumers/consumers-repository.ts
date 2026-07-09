import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { generateId, parseJson, serializeJson } from '../../db/repository-helpers.js';
import type {
  ClientFormat,
  ConsumerRecord,
  ConsumerType,
  InsertConsumerInput,
  UpsertDiscoveredInput,
} from './consumer-types.js';

interface ConsumerRow {
  id: string;
  type: string;
  name: string;
  path: string;
  token: string;
  client_formats: string;
  discovered: number;
  available: number;
  enabled: number;
  created_at: string;
}

function mapConsumerRow(row: ConsumerRow): ConsumerRecord {
  return {
    id: row.id,
    type: row.type as ConsumerType,
    name: row.name,
    path: row.path,
    token: row.token,
    clientFormats: parseJson<ClientFormat[]>(row.client_formats) ?? [],
    discovered: Boolean(row.discovered),
    available: Boolean(row.available),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
  };
}

/** Persists a new consumer row. */
export function insertConsumer(db: Database.Database, input: InsertConsumerInput): ConsumerRecord {
  db.prepare(
    `INSERT INTO consumer (id, type, name, path, token, client_formats, discovered, available, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.type,
    input.name,
    input.path,
    input.token,
    serializeJson(input.clientFormats ?? []),
    input.discovered ? 1 : 0,
    input.available === undefined || input.available ? 1 : 0,
    input.enabled === undefined || input.enabled ? 1 : 0,
    input.createdAt,
  );

  // Non-null: we just inserted this id, getConsumer() is guaranteed to find it.
  return getConsumer(db, input.id)!;
}

export function getConsumer(db: Database.Database, id: string): ConsumerRecord | null {
  const row = db.prepare('SELECT * FROM consumer WHERE id = ?').get(id) as
    | ConsumerRow
    | undefined;
  return row ? mapConsumerRow(row) : null;
}

export function getByPath(db: Database.Database, path: string): ConsumerRecord | null {
  const row = db.prepare('SELECT * FROM consumer WHERE path = ?').get(path) as
    | ConsumerRow
    | undefined;
  return row ? mapConsumerRow(row) : null;
}

/** Returns the single consumer holding `token`, or null when no match --
 * backs gateway token resolution (T28) and rotate-token verification (T44). */
export function getByToken(db: Database.Database, token: string): ConsumerRecord | null {
  const row = db.prepare('SELECT * FROM consumer WHERE token = ?').get(token) as
    | ConsumerRow
    | undefined;
  return row ? mapConsumerRow(row) : null;
}

export function listConsumers(db: Database.Database): ConsumerRecord[] {
  const rows = db.prepare('SELECT * FROM consumer ORDER BY created_at').all() as ConsumerRow[];
  return rows.map(mapConsumerRow);
}

export function updateToken(db: Database.Database, id: string, token: string): void {
  db.prepare('UPDATE consumer SET token = ? WHERE id = ?').run(token, id);
}

export function updateClientFormats(
  db: Database.Database,
  id: string,
  clientFormats: ClientFormat[],
): void {
  db.prepare('UPDATE consumer SET client_formats = ? WHERE id = ?').run(
    serializeJson(clientFormats),
    id,
  );
}

export function setAvailable(db: Database.Database, id: string, available: boolean): void {
  db.prepare('UPDATE consumer SET available = ? WHERE id = ?').run(available ? 1 : 0, id);
}

/** Inserts a new discovered `project` consumer for `path` once; a repeat
 * call with the same path is a no-op that returns the existing row
 * unchanged (idempotent by path). Auto-generates the bearer token; workspace
 * scan (T21) depends only on this repository, not the token-generator owned
 * by the consumers service (T19), so token minting is self-contained here. */
export function upsertDiscovered(
  db: Database.Database,
  input: UpsertDiscoveredInput,
): ConsumerRecord {
  const existing = getByPath(db, input.path);
  if (existing) {
    return existing;
  }

  return insertConsumer(db, {
    id: generateId(),
    type: 'project',
    name: input.name,
    path: input.path,
    token: randomBytes(32).toString('base64url'),
    clientFormats: [],
    discovered: true,
    available: true,
    enabled: true,
    createdAt: input.createdAt,
  });
}

/** Removes the consumer row (its assignment rows cascade via the FK). */
export function deleteConsumer(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM consumer WHERE id = ?').run(id);
}
