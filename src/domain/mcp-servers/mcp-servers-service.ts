import type Database from 'better-sqlite3';
import { generateId, nowIso } from '../../db/repository-helpers.js';
import { sealSecret } from '../../vault/secret-vault.js';
import * as assignmentsRepository from '../assignments/assignments-repository.js';
import * as mcpServersRepository from './mcp-servers-repository.js';
import type { McpServerListItem, McpTransport } from './mcp-server-types.js';

export interface McpServersServiceDeps {
  db: Database.Database;
  /** 32-byte AES-256-GCM master key from config/env.ts, used to seal every
   * secret env value before it ever reaches the repository/insert path. */
  masterKey: Buffer;
}

export interface ServiceSecretInput {
  envKey: string;
  /** Plaintext value; sealed via the vault before persisting -- never
   * passed to the repository as-is (SEC-01). */
  value: string;
}

/** `kind` is the caller's explicit transport-family choice (the UI form's
 * stdio/remote tab): stdio requires `command`, remote requires `url` and
 * derives the persisted transport ('http' unless `sse` is set). This
 * resolves the spec's "derive transport from url vs command" note
 * unambiguously, instead of inferring intent from which optional field
 * happens to be populated. */
export interface CreateServerInput {
  name: string;
  kind: 'stdio' | 'remote';
  command?: string;
  args?: string[];
  url?: string;
  sse?: boolean;
  headers?: Record<string, string>;
  secrets?: ServiceSecretInput[];
}

export interface UpdateServerInput {
  name?: string;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  secrets?: ServiceSecretInput[];
}

/** Invoked exactly once by deleteServer with the ids of consumers whose
 * config needs rewriting after their MCP disappeared. The real writer is
 * Phase 5; here it's dependency-injected so this service stays decoupled
 * from the filesystem. */
export type ConfigRewriteHook = (consumerIds: string[]) => Promise<void> | void;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'mcp';
}

function sealServiceSecrets(secrets: ServiceSecretInput[] | undefined, masterKey: Buffer) {
  return secrets?.map((secret) => {
    const sealed = sealSecret(secret.value, masterKey);
    return { envKey: secret.envKey, iv: sealed.iv, tag: sealed.tag, ciphertext: sealed.ciphertext };
  });
}

/** MCP-01/02/03: validates required fields, rejects duplicate names, derives
 * transport from `kind`, and seals every secret via the vault before any
 * repository write -- on any validation failure nothing is persisted. */
export function createServer(
  deps: McpServersServiceDeps,
  input: CreateServerInput,
): McpServerListItem {
  const name = input.name?.trim();
  if (!name) {
    throw new Error('MCP server name is required');
  }
  if (mcpServersRepository.findByName(deps.db, name)) {
    throw new Error(`MCP server name "${name}" already exists`);
  }

  let transport: McpTransport;
  let command: string | null = null;
  let args: string[] | null = null;
  let url: string | null = null;
  let headers: Record<string, string> | null = null;

  if (input.kind === 'stdio') {
    const command_ = input.command?.trim();
    if (!command_) {
      throw new Error('command is required for a stdio MCP server');
    }
    transport = 'stdio';
    command = command_;
    args = input.args ?? null;
  } else {
    const url_ = input.url?.trim();
    if (!url_) {
      throw new Error('url is required for a remote MCP server');
    }
    transport = input.sse ? 'sse' : 'http';
    url = url_;
    headers = input.headers ?? null;
  }

  const id = generateId();
  mcpServersRepository.insertServer(deps.db, {
    id,
    slug: slugify(name),
    name,
    transport,
    command,
    args,
    url,
    headers,
    createdAt: nowIso(),
    secrets: sealServiceSecrets(input.secrets, deps.masterKey) ?? [],
  });

  // Non-null: insertServer just persisted this id in the same transaction.
  return mcpServersRepository.getServer(deps.db, id)!;
}

/** Applies the provided fields; re-validates name uniqueness (excluding
 * self) and reseals any replacement secrets via the vault. */
export function updateServer(
  deps: McpServersServiceDeps,
  id: string,
  input: UpdateServerInput,
): McpServerListItem {
  if (!mcpServersRepository.getServer(deps.db, id)) {
    throw new Error(`No MCP server found with id: ${id}`);
  }

  let name: string | undefined;
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) {
      throw new Error('MCP server name is required');
    }
    const conflict = mcpServersRepository.findByName(deps.db, trimmed);
    if (conflict && conflict.id !== id) {
      throw new Error(`MCP server name "${trimmed}" already exists`);
    }
    name = trimmed;
  }

  mcpServersRepository.updateServer(deps.db, id, {
    name,
    command: input.command,
    args: input.args,
    url: input.url,
    headers: input.headers,
    secrets: sealServiceSecrets(input.secrets, deps.masterKey),
  });

  // Non-null: existence was checked above and this call never deletes the row.
  return mcpServersRepository.getServer(deps.db, id)!;
}

/** SEC-01: returns only per-envKey hasValue flags, never plaintext/ciphertext. */
export function listServers(deps: McpServersServiceDeps): McpServerListItem[] {
  return mcpServersRepository.listServers(deps.db);
}

export function getServer(deps: McpServersServiceDeps, id: string): McpServerListItem | null {
  return mcpServersRepository.getServer(deps.db, id);
}

/** ACC-02: collects the MCP's consumers, cascades their assignment rows,
 * deletes the server, then invokes the injected rewrite hook exactly once
 * with the affected consumer ids -- including the empty-array case when the
 * MCP had zero consumers. */
export async function deleteServer(
  deps: McpServersServiceDeps,
  id: string,
  onConsumersAffected: ConfigRewriteHook,
): Promise<void> {
  const consumerIds = assignmentsRepository.consumersOfMcp(deps.db, id);
  assignmentsRepository.deleteByMcpId(deps.db, id);
  mcpServersRepository.deleteServer(deps.db, id);
  await onConsumersAffected(consumerIds);
}
