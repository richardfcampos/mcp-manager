import { Router } from 'express';
import { getConsumer } from '../domain/consumers/consumers-repository.js';
import { listConsumers, rotateToken } from '../domain/consumers/consumers-service.js';
import { listServers } from '../domain/mcp-servers/mcp-servers-service.js';
import { rewriteConfigsForConsumers } from '../config-writers/config-rewrite-service.js';
import { NotFoundError, ValidationError, classifyDomainError } from './error-middleware.js';
import type { AppDeps } from './router.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** CFG-01/02: writes every assigned project's native client config
 * (.mcp.json today), idempotently, isolating per-project failures; plus
 * per-consumer token rotation (SEC-03) and per-MCP upstream status.
 * Extended in place by T46 (preview). */
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

  // Rotates a consumer's bearer token (the old one stops resolving
  // immediately, see consumers-repository.updateToken) and rewrites that
  // consumer's config so its written URL embeds the new token.
  router.post('/rotate-token', async (req, res, next) => {
    try {
      const body = req.body;
      if (!isRecord(body) || typeof body.consumerId !== 'string' || !body.consumerId) {
        throw new ValidationError('consumerId is required');
      }
      const existing = getConsumer(deps.db, body.consumerId);
      if (!existing) {
        throw new NotFoundError(`No consumer found with id: ${body.consumerId}`);
      }

      const token = rotateToken({ db: deps.db }, body.consumerId);
      const configRewrites = await rewriteConfigsForConsumers(
        { db: deps.db, gatewayBaseUrl: deps.gatewayBaseUrl },
        [body.consumerId],
      );
      res.status(200).json({ consumerId: body.consumerId, token, configRewrites });
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  // Enumerates EVERY registered MCP (the full catalog via listServers, not
  // only ids the lazy upstream registry has already connected) and reports
  // each one's live status; an MCP never connected defaults to 'stopped'
  // (see UpstreamRegistry.status), so nothing is ever silently omitted.
  router.get('/status', (_req, res) => {
    const servers = listServers({ db: deps.db, masterKey: deps.masterKey });
    const statuses = servers.map((server) => ({
      mcpId: server.id,
      slug: server.slug,
      status: deps.upstreamRegistry.status(server.id),
    }));
    res.status(200).json({ statuses });
  });

  return router;
}
