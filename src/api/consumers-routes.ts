import { Router } from 'express';
import {
  listConsumers,
  registerDesktopProfile,
  registerManualProject,
  setClientFormats,
} from '../domain/consumers/consumers-service.js';
import * as consumersRepository from '../domain/consumers/consumers-repository.js';
import type { ClientFormat } from '../domain/consumers/consumer-types.js';
import { scanWorkspace } from '../domain/discovery/workspace-scan.js';
import { NotFoundError, ValidationError, classifyDomainError } from './error-middleware.js';
import type { AppDeps } from './router.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VALID_CLIENT_FORMATS: readonly ClientFormat[] = ['claude-code', 'cursor', 'vscode'];

function isValidClientFormat(value: unknown): value is ClientFormat {
  return typeof value === 'string' && (VALID_CLIENT_FORMATS as readonly string[]).includes(value);
}

/** PRJ-01/02/03: list (discovered + manual), workspace-discovery rescan,
 * and manual project/desktop-profile registration for consumers. */
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

  router.post('/project', (req, res, next) => {
    try {
      const body = req.body;
      if (!isRecord(body) || typeof body.path !== 'string' || !body.path) {
        throw new ValidationError('path is required');
      }
      const name = typeof body.name === 'string' ? body.name : undefined;
      const consumer = registerManualProject(consumersDeps, body.path, name);
      res.status(201).json(consumer);
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  router.post('/desktop-profile', (req, res, next) => {
    try {
      const body = req.body;
      if (!isRecord(body) || typeof body.dataDir !== 'string' || !body.dataDir) {
        throw new ValidationError('dataDir is required');
      }
      if (typeof body.label !== 'string' || !body.label) {
        throw new ValidationError('label is required');
      }
      const consumer = registerDesktopProfile(consumersDeps, body.dataDir, body.label);
      res.status(201).json(consumer);
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  /** FMT-1/FMT-2: sets which native client config formats get written for a
   * consumer on the next write-configs run. 400 when any entry isn't one of
   * claude-code|cursor|vscode; 404 when the consumer id doesn't exist. */
  router.put('/:id/formats', (req, res, next) => {
    try {
      const existing = consumersRepository.getConsumer(deps.db, req.params.id);
      if (!existing) {
        throw new NotFoundError(`No consumer found with id: ${req.params.id}`);
      }

      const body = req.body;
      if (!isRecord(body) || !Array.isArray(body.clientFormats)) {
        throw new ValidationError('clientFormats is required and must be an array');
      }
      if (!body.clientFormats.every(isValidClientFormat)) {
        throw new ValidationError(
          `clientFormats entries must be one of: ${VALID_CLIENT_FORMATS.join(', ')}`,
        );
      }

      setClientFormats(consumersDeps, req.params.id, body.clientFormats);
      res.status(200).json(consumersRepository.getConsumer(deps.db, req.params.id));
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  return router;
}
