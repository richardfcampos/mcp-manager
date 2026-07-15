import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { createApp } from './api/create-app.js';
import { loadConfig } from './config/env.js';
import { openDatabase } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { mountGateway } from './gateway/gateway-router.js';
import { UpstreamRegistry } from './gateway/upstream-registry.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
// dist/server.js -> ../data (the Dockerfile creates /app/data and
// docker-compose.yml persists it via the mcp-manager-data volume; a bare
// `node dist/server.js` run from the repo root gets the same ./data layout).
const DEFAULT_DB_PATH = join(currentDir, '..', 'data', 'mcp-manager.sqlite');

/** MCP_MANAGER_DB_PATH overrides the default SQLite file location -- used by
 * tooling/tests that need an isolated file (or ':memory:'); production and
 * Docker always use the default under the mounted data volume. Not part of
 * the documented MCP_MANAGER_* env contract in .env.example: like HOST, this
 * is internal deployment plumbing rather than a user-facing setting. */
function resolveDbPath(env: NodeJS.ProcessEnv): string {
  const raw = env.MCP_MANAGER_DB_PATH;
  if (!raw) {
    return DEFAULT_DB_PATH;
  }
  return raw === ':memory:' ? raw : resolve(raw);
}

export interface ProductionServer {
  app: Express;
  close: () => Promise<void>;
}

/**
 * Builds the ONE Express app that serves everything the gateway needs on a
 * single process (T56): opens the SQLite DB and runs migrations, constructs
 * the shared upstream registry, assembles `/api` + the static SPA via the
 * canonical create-app factory (T36), and mounts the gateway router (T29) at
 * `POST /mcp/:token` plus `GET /healthz` on the same app instance --
 * replacing T6's placeholder inline app/static construction, which this
 * function now fully supersedes.
 *
 * `/healthz` is registered on an outer app that wraps the create-app
 * instance as a sub-app (`outer.use(innerApp)`): create-app's SPA fallback
 * is an unconditional `GET *` handler once web/dist exists, so a route
 * appended after createApp() returns would never be reached by Express's
 * registration-order route matching -- registering it on the outer app
 * first guarantees `/healthz` resolves before the SPA fallback ever sees the
 * request. `/mcp/:token` only needs a distinct HTTP method (POST) so it has
 * no such ordering conflict with the inner app's GET-only fallback.
 */
export function buildProductionServer(env: NodeJS.ProcessEnv = process.env): ProductionServer {
  const config = loadConfig(env);
  const dbPath = resolveDbPath(env);
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = openDatabase(dbPath);
  runMigrations(db);

  const upstreamRegistry = new UpstreamRegistry({ db, masterKey: config.masterKey });

  const innerApp = createApp({
    db,
    masterKey: config.masterKey,
    workspaceRoot: config.workspaceRoot,
    gatewayBaseUrl: config.publicBaseUrl,
    upstreamRegistry,
  });

  const app = express();
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  mountGateway(app, { db, registry: upstreamRegistry });
  app.use(innerApp);

  return {
    app,
    close: async () => {
      await upstreamRegistry.shutdown('all');
      db.close();
    },
  };
}

function isMainModule(): boolean {
  const invokedPath = process.argv[1] ? fileURLToPath(new URL(`file://${process.argv[1]}`)) : '';
  return fileURLToPath(import.meta.url) === invokedPath;
}

function main(): void {
  const config = loadConfig(process.env);
  const { app } = buildProductionServer(process.env);

  app.listen(config.port, config.host, () => {
    console.log(`mcp-manager listening on http://${config.host}:${config.port}`);
  });
}

if (isMainModule()) {
  main();
}
