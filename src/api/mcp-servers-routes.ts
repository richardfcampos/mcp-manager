import { Router } from 'express';
import {
  createServer,
  updateServer,
  type CreateServerInput,
  type ServiceSecretInput,
  type UpdateServerInput,
} from '../domain/mcp-servers/mcp-servers-service.js';
import { ValidationError, classifyDomainError } from './error-middleware.js';
import type { AppDeps } from './router.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the incoming secrets array shape (`[{envKey, value}]`) at the
 * HTTP boundary before it ever reaches the domain service. */
function parseSecrets(raw: unknown): ServiceSecretInput[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new ValidationError('secrets must be an array of {envKey, value}');
  }
  return raw.map((item, index) => {
    if (!isRecord(item) || typeof item.envKey !== 'string' || typeof item.value !== 'string') {
      throw new ValidationError(`secrets[${index}] must have a string envKey and value`);
    }
    return { envKey: item.envKey, value: item.value };
  });
}

function parseCreateInput(body: unknown): CreateServerInput {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  if (body.kind !== 'stdio' && body.kind !== 'remote') {
    throw new ValidationError('kind must be "stdio" or "remote"');
  }

  return {
    name: typeof body.name === 'string' ? body.name : '',
    kind: body.kind,
    command: typeof body.command === 'string' ? body.command : undefined,
    args: Array.isArray(body.args) ? (body.args as string[]) : undefined,
    url: typeof body.url === 'string' ? body.url : undefined,
    sse: typeof body.sse === 'boolean' ? body.sse : undefined,
    headers: isRecord(body.headers) ? (body.headers as Record<string, string>) : undefined,
    secrets: parseSecrets(body.secrets),
  };
}

function parseUpdateInput(body: unknown): UpdateServerInput {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }

  return {
    name: typeof body.name === 'string' ? body.name : undefined,
    command:
      body.command === null ? null : typeof body.command === 'string' ? body.command : undefined,
    args: body.args === null ? null : Array.isArray(body.args) ? (body.args as string[]) : undefined,
    url: body.url === null ? null : typeof body.url === 'string' ? body.url : undefined,
    headers:
      body.headers === null
        ? null
        : isRecord(body.headers)
          ? (body.headers as Record<string, string>)
          : undefined,
    secrets: parseSecrets(body.secrets),
  };
}

/** MCP-01/02/03: create/update for registered MCP servers. Extended in
 * place by T38 (list/detail) and T39 (delete). */
export function createMcpServersRoute(deps: AppDeps): Router {
  const router = Router();
  const serviceDeps = { db: deps.db, masterKey: deps.masterKey };

  router.post('/', (req, res, next) => {
    try {
      const input = parseCreateInput(req.body);
      const created = createServer(serviceDeps, input);
      res.status(201).json(created);
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  router.put('/:id', (req, res, next) => {
    try {
      const input = parseUpdateInput(req.body);
      const updated = updateServer(serviceDeps, req.params.id, input);
      res.status(200).json(updated);
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  return router;
}
