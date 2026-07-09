import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** Gateway + UI always bind to loopback only; never configurable to 0.0.0.0. */
const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MASTER_KEY_BYTES = 32;

export interface AppConfig {
  /** Bind port for the Express server (API + gateway + static SPA). */
  port: number;
  /** Bind host; always loopback, never read from env. */
  host: string;
  /** Absolute path to the mounted workspace root used for project discovery. */
  workspaceRoot: string;
  /** 32-byte AES-256-GCM master key used by the secret vault. */
  masterKey: Buffer;
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

  return {
    port,
    host: LOOPBACK_HOST,
    workspaceRoot,
    masterKey,
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
