import { Router } from 'express';
import { listConsumers } from '../domain/consumers/consumers-service.js';
import { rewriteConfigsForConsumers } from '../config-writers/config-rewrite-service.js';
import type { AppDeps } from './router.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** CFG-01/02: writes every assigned project's native client config
 * (.mcp.json today), idempotently, isolating per-project failures.
 * Extended in place by T44 (rotate-token), T45 (status), T46 (preview). */
export function createActionsRoute(deps: AppDeps): Router {
  const router = Router();

  router.post('/write-configs', async (req, res, next) => {
    try {
      const body = req.body;
      const consumerIds =
        isRecord(body) && Array.isArray(body.consumerIds)
          ? (body.consumerIds as unknown[]).filter((id): id is string => typeof id === 'string')
          : listConsumers({ db: deps.db }).map((consumer) => consumer.id);

      const results = await rewriteConfigsForConsumers(
        { db: deps.db, gatewayBaseUrl: deps.gatewayBaseUrl },
        consumerIds,
      );
      res.status(200).json({ results });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
