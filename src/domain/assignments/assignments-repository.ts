import type Database from 'better-sqlite3';
import { generateId, nowIso } from '../../db/repository-helpers.js';

/** Persists a (consumerId, mcpServerId) assignment row. Relies on the
 * UNIQUE(consumer_id, mcp_server_id) constraint (see migrations/0001_init.sql)
 * via INSERT OR IGNORE so a duplicate pair never creates a second row and
 * never throws (ACC-01). */
export function assign(db: Database.Database, consumerId: string, mcpServerId: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO assignment (id, consumer_id, mcp_server_id, created_at) VALUES (?, ?, ?, ?)',
  ).run(generateId(), consumerId, mcpServerId, nowIso());
}

/** Removes the assignment row; a no-op (no throw) when it was not assigned. */
export function unassign(db: Database.Database, consumerId: string, mcpServerId: string): void {
  db.prepare('DELETE FROM assignment WHERE consumer_id = ? AND mcp_server_id = ?').run(
    consumerId,
    mcpServerId,
  );
}

/** Returns only the given consumer's assigned mcpServerIds. */
export function allowedMcpIds(db: Database.Database, consumerId: string): string[] {
  const rows = db
    .prepare('SELECT mcp_server_id FROM assignment WHERE consumer_id = ?')
    .all(consumerId) as Array<{ mcp_server_id: string }>;
  return rows.map((row) => row.mcp_server_id);
}

/** Returns only the consumers assigned to the given mcp server. */
export function consumersOfMcp(db: Database.Database, mcpServerId: string): string[] {
  const rows = db
    .prepare('SELECT consumer_id FROM assignment WHERE mcp_server_id = ?')
    .all(mcpServerId) as Array<{ consumer_id: string }>;
  return rows.map((row) => row.consumer_id);
}

/** Removes every assignment row for the given mcpServerId. */
export function deleteByMcpId(db: Database.Database, mcpServerId: string): void {
  db.prepare('DELETE FROM assignment WHERE mcp_server_id = ?').run(mcpServerId);
}

/** Removes every assignment row for the given consumerId. */
export function deleteByConsumerId(db: Database.Database, consumerId: string): void {
  db.prepare('DELETE FROM assignment WHERE consumer_id = ?').run(consumerId);
}
