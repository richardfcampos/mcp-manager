import { Router } from 'express';
import {
  allowedMcpIds,
  assign,
  consumersOfMcp,
  unassign,
} from '../domain/assignments/assignments-service.js';
import { listConsumers } from '../domain/consumers/consumers-service.js';
import { listServers } from '../domain/mcp-servers/mcp-servers-service.js';
import { ValidationError, classifyDomainError } from './error-middleware.js';
import type { AppDeps } from './router.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePair(body: unknown): { consumerId: string; mcpServerId: string } {
  if (
    !isRecord(body) ||
    typeof body.consumerId !== 'string' ||
    !body.consumerId ||
    typeof body.mcpServerId !== 'string' ||
    !body.mcpServerId
  ) {
    throw new ValidationError('consumerId and mcpServerId are required');
  }
  return { consumerId: body.consumerId, mcpServerId: body.mcpServerId };
}

/** ACC-01: assign/unassign a consumer<->MCP pair, plus a full matrix read. */
export function createAssignmentsRoute(deps: AppDeps): Router {
  const router = Router();
  const asgDeps = { db: deps.db };

  router.post('/', (req, res, next) => {
    try {
      const { consumerId, mcpServerId } = parsePair(req.body);
      assign(asgDeps, consumerId, mcpServerId);
      res.status(201).json({ consumerId, mcpServerId });
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  router.delete('/', (req, res, next) => {
    try {
      const { consumerId, mcpServerId } = parsePair(req.body);
      unassign(asgDeps, consumerId, mcpServerId);
      res.status(200).json({ consumerId, mcpServerId });
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  router.get('/', (_req, res) => {
    const consumers = listConsumers({ db: deps.db });
    const servers = listServers({ db: deps.db, masterKey: deps.masterKey });

    res.status(200).json({
      consumers: consumers.map((consumer) => ({
        consumerId: consumer.id,
        allowedMcpIds: allowedMcpIds(asgDeps, consumer.id),
      })),
      mcpServers: servers.map((server) => ({
        mcpServerId: server.id,
        consumerIds: consumersOfMcp(asgDeps, server.id),
      })),
    });
  });

  return router;
}
