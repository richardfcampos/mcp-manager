import Database from 'better-sqlite3';

/**
 * Opens a better-sqlite3 connection with the pragmas every caller in this
 * app relies on: foreign_keys ON so cascade deletes (secret/assignment rows)
 * are enforced by SQLite itself, and WAL journal mode for concurrent
 * read/write safety under the Express request lifecycle.
 *
 * Accepts ':memory:' (parallel-safe, per-test isolation) and on-disk file
 * paths (production/dev); the parent directory of a file path is assumed to
 * already exist (created by deployment tooling, not this factory).
 */
export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  return db;
}
