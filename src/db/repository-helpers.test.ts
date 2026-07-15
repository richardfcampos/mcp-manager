import { describe, expect, it } from 'vitest';
import { openDatabase } from './connection.js';
import { parseJson, serializeJson, withTransaction } from './repository-helpers.js';

describe('repository-helpers', () => {
  it('round-trips an array/object value through serializeJson -> parseJson', () => {
    const value = { formats: ['claude-code', 'cursor'], count: 2 };

    const text = serializeJson(value);
    const parsed = parseJson<typeof value>(text);

    expect(parsed).toEqual(value);
  });

  it('parseJson(null) returns null without throwing', () => {
    expect(() => parseJson(null)).not.toThrow();
    expect(parseJson(null)).toBeNull();
    expect(parseJson(undefined)).toBeNull();
  });

  it('withTransaction commits all writes on success', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');

    withTransaction(db, () => {
      db.prepare('INSERT INTO t (id) VALUES (?)').run('a');
      db.prepare('INSERT INTO t (id) VALUES (?)').run('b');
    });

    expect(db.prepare('SELECT id FROM t').all()).toHaveLength(2);
  });

  it('withTransaction rolls back all writes when fn throws', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');

    expect(() =>
      withTransaction(db, () => {
        db.prepare('INSERT INTO t (id) VALUES (?)').run('a');
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(db.prepare('SELECT id FROM t').all()).toHaveLength(0);
  });
});
