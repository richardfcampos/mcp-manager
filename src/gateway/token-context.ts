import type Database from 'better-sqlite3';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import * as assignmentsService from '../domain/assignments/assignments-service.js';
import * as consumersService from '../domain/consumers/consumers-service.js';
import type { ConsumerRecord } from '../domain/consumers/consumer-types.js';

export interface TokenContextDeps {
  db: Database.Database;
}

/** The resolved gateway scope attached to `req` once token-context has run.
 * Present on `req` only after this middleware's `next()` is called --
 * unknown/disabled tokens short-circuit with a 401 before either field is
 * set. */
export interface GatewayRequestContext {
  consumer: ConsumerRecord;
  allowedMcpIds: string[];
}

export type GatewayRequest = Request & Partial<GatewayRequestContext>;

/**
 * SEC-02/GW-01: resolves `req.params.token` to a consumer (via
 * consumers-service.getByToken) and, when found and enabled, that
 * consumer's allowed MCP scope (via assignments-service.allowedMcpIds),
 * attaching both to `req` before calling `next()`. An unknown token or a
 * disabled consumer responds 401 with no scope attached and `next()` is
 * never called -- no tools/session can be exposed downstream (SEC-02).
 * A consumer with zero assignments still passes through with an empty
 * `allowedMcpIds` array, not a 401 (empty scope is a valid outcome).
 *
 * Runs before the per-request MCP Server/transport is built (gateway-router
 * T29), resolving the spike's (T22) transport-timing risk the same way:
 * synchronously in the Express handler chain, before any transport code
 * runs.
 */
export function createTokenContext(deps: TokenContextDeps): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.params.token;
    const consumer = consumersService.getByToken(deps, token);

    if (!consumer || !consumer.enabled) {
      res.status(401).json({ error: 'invalid or unknown token' });
      return;
    }

    const gatewayReq = req as GatewayRequest;
    gatewayReq.consumer = consumer;
    gatewayReq.allowedMcpIds = assignmentsService.allowedMcpIds(deps, consumer.id);
    next();
  };
}
