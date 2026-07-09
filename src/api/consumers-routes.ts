import { Router } from 'express';
import { listConsumers } from '../domain/consumers/consumers-service.js';
import { scanWorkspace } from '../domain/discovery/workspace-scan.js';
import type { AppDeps } from './router.js';

/** PRJ-01/02/03: list (discovered + manual) and workspace-discovery rescan
 * for consumers. Extended in place by T41 (manual registration). */
export function createConsumersRoute(deps: AppDeps): Router {
  const router = Router();
  const consumersDeps = { db: deps.db };

  router.get('/', (_req, res) => {
    res.status(200).json(listConsumers(consumersDeps));
  });

  router.post('/discover', (_req, res, next) => {
    try {
      const result = scanWorkspace({ db: deps.db }, deps.workspaceRoot);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
