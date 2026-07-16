import { Router } from 'express';
import {
  createServer,
  deleteServerAndRewriteConfigs,
  getServer,
  listServers,
  updateServer,
  type CreateServerInput,
  type ServiceSecretInput,
  type UpdateServerInput,
} from '../domain/mcp-servers/mcp-servers-service.js';
import { NotFoundError, ValidationError, classifyDomainError } from './error-middleware.js';
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
    purpose: typeof body.purpose === 'string' ? body.purpose : undefined,
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
    purpose: body.purpose === null ? null : typeof body.purpose === 'string' ? body.purpose : undefined,
    secrets: parseSecrets(body.secrets),
    removeSecretKeys: parseRemoveSecretKeys(body.removeSecretKeys),
  };
}

/** Env keys whose secret rows the update deletes: must be an array of
 * non-empty strings, so a malformed payload never silently skips a
 * requested deletion. */
function parseRemoveSecretKeys(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((key) => typeof key === 'string' && key.trim())) {
    throw new ValidationError('removeSecretKeys must be an array of non-empty strings');
  }
  return value as string[];
}

/** MCP-01/02/03, SEC-01, ACC-02: create/update/list/detail/delete for
 * registered MCP servers. */
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

  router.put('/:id', async (req, res, next) => {
    try {
      const input = parseUpdateInput(req.body);
      const updated = updateServer(serviceDeps, req.params.id, input);
      // Drop any live upstream connection so the next call re-resolves the
      // new config/secrets. An already-connected MCP process keeps the env
      // it was spawned with, so an edited token is invisible until the
      // cached client is dropped and reconnected.
      await deps.upstreamRegistry.shutdown(req.params.id);
      res.status(200).json(updated);
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  // SEC-01: listServers/getServer already return only per-envKey hasValue
  // flags (see mcp-servers-repository.ts) -- never plaintext or ciphertext,
  // so no extra sanitization is needed at the route layer.
  router.get('/', (_req, res) => {
    res.status(200).json(listServers(serviceDeps));
  });

  router.get('/:id', (req, res, next) => {
    const server = getServer(serviceDeps, req.params.id);
    if (!server) {
      next(new NotFoundError(`No MCP server found with id: ${req.params.id}`));
      return;
    }
    res.status(200).json(server);
  });

  // ACC-02: captures the MCP's consumers, cascades their assignment rows,
  // deletes the server, and rewrites every affected consumer's config in
  // one call (see deleteServerAndRewriteConfigs).
  router.delete('/:id', async (req, res, next) => {
    try {
      const existing = getServer(serviceDeps, req.params.id);
      if (!existing) {
        throw new NotFoundError(`No MCP server found with id: ${req.params.id}`);
      }
      const configRewrites = await deleteServerAndRewriteConfigs(
        { db: deps.db, masterKey: deps.masterKey, gatewayBaseUrl: deps.gatewayBaseUrl },
        req.params.id,
      );
      // Close the live upstream (if any) so a deleted MCP's child process
      // doesn't linger connected after its config is gone.
      await deps.upstreamRegistry.shutdown(req.params.id);
      res.status(200).json({ deleted: true, configRewrites });
    } catch (err) {
      next(classifyDomainError(err));
    }
  });

  return router;
}
