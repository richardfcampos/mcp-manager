import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { openDatabase } from '../../../src/db/connection.js';
import { runMigrations } from '../../../src/db/migrate.js';
import { createApp } from '../../../src/api/create-app.js';
import { UpstreamRegistry } from '../../../src/gateway/upstream-registry.js';

export interface TestApp {
  app: Express;
  db: Database.Database;
  upstreamRegistry: UpstreamRegistry;
  masterKey: Buffer;
  workspaceRoot: string;
  gatewayBaseUrl: string;
  /** Shuts down every cached upstream connection and closes the DB. Every
   * test that calls buildTestApp MUST call this in an afterEach so state
   * (child processes, sqlite handles) never leaks across tests running in
   * the same sequential integration run. */
  close: () => Promise<void>;
}

export interface BuildTestAppOptions {
  /** Overrides the auto-created temp workspace root (e.g. to point
   * discovery tests at a directory pre-populated with fixture folders). */
  workspaceRoot?: string;
}

/**
 * Boots the real production app-assembly path (create-app) against a fresh,
 * isolated in-memory SQLite DB -- migrated on every call -- so each test
 * gets a clean slate. This is the single harness every Phase 6 API
 * integration test builds against (no test constructs its own Express app).
 */
export function buildTestApp(options: BuildTestAppOptions = {}): TestApp {
  const db = openDatabase(':memory:');
  runMigrations(db);

  const masterKey = randomBytes(32);
  const workspaceRoot =
    options.workspaceRoot ?? mkdtempSync(join(tmpdir(), 'mcp-manager-test-workspace-'));
  const gatewayBaseUrl = 'http://127.0.0.1:4317';
  const upstreamRegistry = new UpstreamRegistry({ db, masterKey });

  const app = createApp({
    db,
    masterKey,
    workspaceRoot,
    gatewayBaseUrl,
    upstreamRegistry,
    // No built web/dist in the test environment; static/SPA serving is not
    // under test here (covered by the T7 build gate).
    webDistDir: join(tmpdir(), 'mcp-manager-test-no-such-web-dist-dir'),
  });

  return {
    app,
    db,
    upstreamRegistry,
    masterKey,
    workspaceRoot,
    gatewayBaseUrl,
    close: async () => {
      await upstreamRegistry.shutdown('all');
      db.close();
    },
  };
}
