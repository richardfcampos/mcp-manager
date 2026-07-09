import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Default bind host: loopback-only, so running the server directly on a
 * host machine never exposes the unauthenticated local UI/API to the LAN.
 *
 * Not part of the documented MCP_MANAGER_* env contract (see .env.example):
 * this is internal deployment plumbing, not a user-facing setting. The only
 * legitimate reason to override it is Docker's bridge network, where a
 * container process bound to its own loopback is unreachable through the
 * container's published port — the Dockerfile sets HOST=0.0.0.0 for that
 * case, while the actual "never leaves localhost" guarantee is enforced one
 * layer out, by docker-compose publishing the port on 127.0.0.1 only.
 */
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MASTER_KEY_BYTES = 32;

export interface AppConfig {
  /** Bind port for the Express server (API + gateway + static SPA). */
  port: number;
  /** Bind host; defaults to loopback, see DEFAULT_HOST for override rules. */
  host: string;
  /** Absolute path to the mounted workspace root used for project discovery. */
  workspaceRoot: string;
  /** 32-byte AES-256-GCM master key used by the secret vault. */
  masterKey: Buffer;
  /** Host-reachable base URL for the gateway (e.g. what a client outside the
   * container/loopback can actually reach), used to render `/mcp/<token>`
   * URLs into every written client config. Defaults to the loopback bind
   * address + port, which is only correct for same-host clients -- deployments
   * exposing the gateway differently (a reverse proxy, a different published
   * port) must set MCP_MANAGER_PUBLIC_BASE_URL explicitly. */
  publicBaseUrl: string;
}

/** Minimal shape of the env vars this loader reads; kept structural so callers
 * can pass `process.env` or a plain object (e.g. in tests) interchangeably. */
export type EnvSource = Record<string, string | undefined>;

/**
 * Loads and validates the process environment into a typed AppConfig.
 * Fails fast (throws) on any missing/malformed required value so the server
 * never starts in a half-configured, insecure state.
 */
export function loadConfig(env: EnvSource): AppConfig {
  const masterKey = parseMasterKey(env.MCP_MANAGER_MASTER_KEY);
  const workspaceRoot = resolveWorkspaceRoot(env.MCP_MANAGER_WORKSPACE_ROOT);
  const port = parsePort(env.PORT);
  const host = env.HOST || DEFAULT_HOST;

  return {
    port,
    host,
    workspaceRoot,
    masterKey,
    publicBaseUrl: env.MCP_MANAGER_PUBLIC_BASE_URL || `http://127.0.0.1:${port}`,
  };
}

function parseMasterKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new Error(
      'MCP_MANAGER_MASTER_KEY is required. Generate one with: openssl rand -base64 32',
    );
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(
      `MCP_MANAGER_MASTER_KEY must decode to exactly ${MASTER_KEY_BYTES} bytes for AES-256-GCM, got ${key.length} bytes.`,
    );
  }

  return key;
}

function resolveWorkspaceRoot(raw: string | undefined): string {
  const workspaceRoot = resolve(raw ?? process.cwd());

  if (!existsSync(workspaceRoot) || !statSync(workspaceRoot).isDirectory()) {
    throw new Error(
      `MCP_MANAGER_WORKSPACE_ROOT does not resolve to an existing directory: ${workspaceRoot}`,
    );
  }

  return workspaceRoot;
}

function parsePort(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_PORT;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a positive integer between 1 and 65535, got: ${raw}`);
  }

  return port;
}
