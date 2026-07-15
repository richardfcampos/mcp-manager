import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

const DEFAULT_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Applies every migrations/*.sql file in filename order, tracking applied
 * filenames in a schema_migrations table so re-running against an
 * already-migrated database is a no-op (idempotent). All pending migrations
 * for a single run apply inside one transaction so a mid-run failure leaves
 * the schema untouched rather than half-migrated.
 */
export function runMigrations(
  db: Database.Database,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  );

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>).map(
      (row) => row.id,
    ),
  );

  const pending = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .filter((file) => !applied.has(file));

  if (pending.length === 0) {
    return;
  }

  const recordMigration = db.prepare(
    'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
  );

  const applyPending = db.transaction((files: string[]) => {
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      db.exec(sql);
      recordMigration.run(file, new Date().toISOString());
    }
  });

  applyPending(pending);
}
