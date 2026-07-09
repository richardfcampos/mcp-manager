import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

/**
 * Runs `fn` inside a better-sqlite3 transaction: all writes commit together
 * on success, and roll back together if `fn` throws. Used by domain repos
 * (Phase 3) to keep multi-statement writes (e.g. server + secret rows)
 * atomic.
 */
export function withTransaction<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn)();
}

/** Serializes a non-secret value (array/object) for a JSON TEXT column
 * (e.g. mcp_server.args, consumer.client_formats). */
export function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Parses a JSON TEXT column value back into its original shape.
 * null/undefined-safe: returns null instead of throwing for empty columns. */
export function parseJson<T = unknown>(text: string | null | undefined): T | null {
  if (text === null || text === undefined) {
    return null;
  }
  return JSON.parse(text) as T;
}

/** Generates a new random id for primary keys. */
export function generateId(): string {
  return randomUUID();
}

/** Current timestamp as an ISO-8601 string, for created_at-style columns. */
export function nowIso(): string {
  return new Date().toISOString();
}
