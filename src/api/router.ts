import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { UpstreamRegistry } from '../gateway/upstream-registry.js';
import { createHealthRoute } from './health-route.js';

/**
 * Shared dependency bag threaded into every `/api/*` sub-router. Constructed
 * once by the caller (the integration test harness, or the production
 * server in a later phase) and passed into `createApp`, which forwards it
 * here unchanged -- no sub-router ever opens its own DB connection or
 * constructs its own registry.
 */
export interface AppDeps {
  db: Database.Database;
  /** 32-byte AES-256-GCM master key, used by services that seal/open secrets. */
  masterKey: Buffer;
  /** Absolute path to the mounted workspace root, used by discovery routes. */
  workspaceRoot: string;
  /** Reachable base URL for the gateway (e.g. `http://127.0.0.1:3000`), used
   * by every route that renders/writes a `/mcp/<token>` URL into a config. */
  gatewayBaseUrl: string;
  upstreamRegistry: UpstreamRegistry;
}

/**
 * Aggregates every `/api/*` sub-router behind one Router instance mounted by
 * create-app. Starts with only `/health`; extended in place by later Phase 6
 * route tasks (mcp-servers, consumers, assignments, actions).
 */
export function createApiRouter(_deps: AppDeps): Router {
  const router = Router();

  router.use(createHealthRoute());

  return router;
}
