import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router } from 'express';
import { allowedMcpIds } from '../domain/assignments/assignments-service.js';
import { getConsumer } from '../domain/consumers/consumers-repository.js';
import { listConsumers, rotateToken } from '../domain/consumers/consumers-service.js';
import type { ConsumerRecord } from '../domain/consumers/consumer-types.js';
import { getServer, listServers } from '../domain/mcp-servers/mcp-servers-service.js';
import { rewriteConfigsForConsumers } from '../config-writers/config-rewrite-service.js';
import { MANAGED_KEY, mergeManagedEntries, removeManagedEntries } from '../config-writers/managed-block.js';
import type { ManagedEntry } from '../config-writers/writer-interface.js';
import { NotFoundError, ValidationError, classifyDomainError } from './error-middleware.js';
import type { AppDeps } from './router.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read-only mirror of claude-code-writer's read+merge+serialize steps
 * (see src/config-writers/claude-code-writer.ts), stopping short of the
 * actual `writeFileSync` -- reuses the same managed-block merge helpers so
 * the previewed content matches exactly what a real write would produce,
 * without ever touching the filesystem beyond a read. */
function renderClaudeCodePreview(
  consumer: ConsumerRecord,
  gatewayBaseUrl: string,
  hasAssignments: boolean,
): string {
  const path = join(consumer.path, '.mcp.json');
  const currentContent = existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
  const existing =
    currentContent && currentContent.trim()
      ? (JSON.parse(currentContent) as { mcpServers?: Record<string, unknown>; [key: string]: unknown })
      : {};
  const existingServers = existing.mcpServers ?? {};

  const entry: ManagedEntry = {
    type: 'http',
    url: `${gatewayBaseUrl}/mcp/${consumer.token}`,
    headers: { Authorization: `Bearer ${consumer.token}` },
  };
  const mcpServers = hasAssignments
    ? mergeManagedEntries(existingServers, { [MANAGED_KEY]: entry })
    : removeManagedEntries(existingServers, [MANAGED_KEY]);

  return `${JSON.stringify({ ...existing, mcpServers }, null, 2)}\n`;
}

/** CFG-01/02: writes every assigned project's native client config
 * (.mcp.json today), idempotently, isolating per-project failures; plus
 * per-consumer token rotation (SEC-03), per-MCP upstream status, and a
 * dry-run config preview. */
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
      error: deps.upstreamRegistry.lastError(server.id),
    }));
    res.status(200).json({ statuses });
  });

  // On-demand connectivity check: forces the lazy upstream to connect NOW
  // and reports the outcome, so "is this MCP actually working?" is a button
  // instead of waiting for a client's first tool call. Always 200 -- the
  // outcome (running vs error + reason) is the payload, not an HTTP failure.
  router.post('/test-mcp', async (req, res, next) => {
    try {
      const body = req.body;
      if (!isRecord(body) || typeof body.mcpId !== 'string' || !body.mcpId) {
        throw new ValidationError('mcpId is required');
      }
      const server = getServer({ db: deps.db, masterKey: deps.masterKey }, body.mcpId);
      if (!server) {
        throw new NotFoundError(`No MCP server found with id: ${body.mcpId}`);
      }

      try {
        await deps.upstreamRegistry.getClient(body.mcpId);
        res.status(200).json({ mcpId: body.mcpId, slug: server.slug, status: 'running' });
      } catch (err) {
        res.status(200).json({
          mcpId: body.mcpId,
          slug: server.slug,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  // Renders the config content that a write-configs call WOULD produce for
  // this consumer, without creating or modifying any file on disk.
  router.get('/preview', (req, res, next) => {
    try {
      const consumerId = typeof req.query.consumerId === 'string' ? req.query.consumerId : '';
      if (!consumerId) {
        throw new ValidationError('consumerId query parameter is required');
      }
      const consumer = getConsumer(deps.db, consumerId);
      if (!consumer) {
        throw new NotFoundError(`No consumer found with id: ${consumerId}`);
      }

      const hasAssignments = allowedMcpIds({ db: deps.db }, consumerId).length > 0;
      const content = renderClaudeCodePreview(consumer, deps.gatewayBaseUrl, hasAssignments);
      res.status(200).type('application/json').send(content);
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  return router;
}
