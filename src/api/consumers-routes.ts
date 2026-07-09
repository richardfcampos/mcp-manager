import { Router } from 'express';
import {
  listConsumers,
  registerDesktopProfile,
  registerManualProject,
} from '../domain/consumers/consumers-service.js';
import { scanWorkspace } from '../domain/discovery/workspace-scan.js';
import { ValidationError, classifyDomainError } from './error-middleware.js';
import type { AppDeps } from './router.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

  return router;
}
