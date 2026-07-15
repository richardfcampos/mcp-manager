import { Router } from 'express';

/** GET /api/health -- unauthenticated liveness probe; no deps, no DB touch. */
export function createHealthRoute(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return router;
}
