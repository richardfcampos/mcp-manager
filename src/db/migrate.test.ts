import { describe, expect, it } from 'vitest';
import { openDatabase } from './connection.js';
import { runMigrations } from './migrate.js';

/** Fresh in-memory, fully-migrated database per call -- parallel-safe. */
function migratedDb() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

describe('runMigrations', () => {
  it('creates all four core tables', () => {
    const db = migratedDb();

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining(['mcp_server', 'secret', 'consumer', 'assignment']),
    );
  });

  it('rejects a duplicate mcp_server.slug', () => {
    const db = migratedDb();
    const insert = db.prepare(
      'INSERT INTO mcp_server (id, slug, name, transport, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run('mcp-1', 'github', 'GitHub', 'stdio', new Date().toISOString());

    expect(() =>
      insert.run('mcp-2', 'github', 'GitHub Two', 'stdio', new Date().toISOString()),
    ).toThrow();
  });

  it('cascades delete of an mcp_server to its secret and assignment rows', () => {
    const db = migratedDb();
    const now = new Date().toISOString();

    db.prepare(
      'INSERT INTO mcp_server (id, slug, name, transport, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('mcp-1', 'github', 'GitHub', 'stdio', now);
    db.prepare(
      'INSERT INTO secret (id, mcp_server_id, env_key, iv, tag, ciphertext) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('secret-1', 'mcp-1', 'GITHUB_TOKEN', 'iv', 'tag', 'cipher');
    db.prepare(
      'INSERT INTO consumer (id, type, name, path, token, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('consumer-1', 'project', 'demo', '/tmp/demo', 'tok-1', now);
    db.prepare(
      'INSERT INTO assignment (id, consumer_id, mcp_server_id, created_at) VALUES (?, ?, ?, ?)',
    ).run('assignment-1', 'consumer-1', 'mcp-1', now);

    db.prepare('DELETE FROM mcp_server WHERE id = ?').run('mcp-1');

    expect(db.prepare('SELECT * FROM secret WHERE mcp_server_id = ?').all('mcp-1')).toHaveLength(
      0,
    );
    expect(
      db.prepare('SELECT * FROM assignment WHERE mcp_server_id = ?').all('mcp-1'),
    ).toHaveLength(0);
  });

  it('rejects inserting a secret with an unknown mcp_server_id (foreign_keys enforced)', () => {
    const db = migratedDb();

    expect(() =>
      db
        .prepare(
          'INSERT INTO secret (id, mcp_server_id, env_key, iv, tag, ciphertext) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('secret-1', 'missing-mcp', 'GITHUB_TOKEN', 'iv', 'tag', 'cipher'),
    ).toThrow();
  });

  it('is idempotent: re-running migrations on an already-migrated db is a no-op', () => {
    const db = migratedDb();
    const before = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all();

    expect(() => runMigrations(db)).not.toThrow();

    const after = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all();
    expect(after).toEqual(before);
  });
});
