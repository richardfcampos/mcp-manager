import type Database from 'better-sqlite3';
import { generateId, parseJson, serializeJson, withTransaction } from '../../db/repository-helpers.js';
import type {
  InsertServerInput,
  McpServerListItem,
  McpServerRecord,
  McpTransport,
  ScopedMcp,
  SealedSecretRow,
  UpdateServerInput,
} from './mcp-server-types.js';

interface McpServerRow {
  id: string;
  slug: string;
  name: string;
  transport: string;
  command: string | null;
  args: string | null;
  url: string | null;
  headers: string | null;
  created_at: string;
  purpose: string | null;
}

interface SecretRow {
  id: string;
  mcp_server_id: string;
  env_key: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function mapServerRow(row: McpServerRow): McpServerRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    transport: row.transport as McpTransport,
    command: row.command,
    args: parseJson<string[]>(row.args),
    url: row.url,
    headers: parseJson<Record<string, string>>(row.headers),
    createdAt: row.created_at,
    purpose: row.purpose,
  };
}

function insertSecretRows(
  db: Database.Database,
  mcpServerId: string,
  secrets: InsertServerInput['secrets'],
): void {
  const insertSecret = db.prepare(
    'INSERT INTO secret (id, mcp_server_id, env_key, iv, tag, ciphertext) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const secret of secrets) {
    insertSecret.run(
      generateId(),
      mcpServerId,
      secret.envKey,
      secret.iv,
      secret.tag,
      secret.ciphertext,
    );
  }
}

/** Persists a new MCP server row plus its sealed secret rows (already
 * encrypted by the caller) inside a single transaction. */
export function insertServer(db: Database.Database, input: InsertServerInput): void {
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO mcp_server (id, slug, name, transport, command, args, url, headers, created_at, purpose)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.slug,
      input.name,
      input.transport,
      input.command ?? null,
      serializeJson(input.args ?? null),
      input.url ?? null,
      serializeJson(input.headers ?? null),
      input.createdAt,
      // Guarded like the other optional metadata fields above: callers that
      // predate this column (or omit it) get null rather than a bind error.
      input.purpose ?? null,
    );
    insertSecretRows(db, input.id, input.secrets);
  });
}

function secretFlags(db: Database.Database, mcpServerId: string): McpServerListItem['secrets'] {
  const rows = db
    .prepare('SELECT env_key FROM secret WHERE mcp_server_id = ?')
    .all(mcpServerId) as Array<{ env_key: string }>;
  return rows.map((row) => ({ envKey: row.env_key, hasValue: true }));
}

/** Returns server metadata plus per-envKey hasValue flags only -- never
 * plaintext, never ciphertext (SEC-01). */
export function getServer(db: Database.Database, id: string): McpServerListItem | null {
  const row = db.prepare('SELECT * FROM mcp_server WHERE id = ?').get(id) as
    | McpServerRow
    | undefined;
  if (!row) {
    return null;
  }
  return { ...mapServerRow(row), secrets: secretFlags(db, id) };
}

/** Lists every server's metadata plus per-envKey hasValue flags only --
 * never plaintext, never ciphertext (SEC-01). */
export function listServers(db: Database.Database): McpServerListItem[] {
  const rows = db.prepare('SELECT * FROM mcp_server ORDER BY created_at').all() as McpServerRow[];
  return rows.map((row) => ({ ...mapServerRow(row), secrets: secretFlags(db, row.id) }));
}

/** Updates the provided fields. Secrets are per-key operations:
 * `removeSecretKeys` deletes those rows, then `secrets` upserts by env_key
 * (only the provided keys are replaced) -- untouched keys keep their sealed
 * values, since the client never holds them to resend. */
export function updateServer(db: Database.Database, id: string, input: UpdateServerInput): void {
  withTransaction(db, () => {
    const current = db.prepare('SELECT * FROM mcp_server WHERE id = ?').get(id) as
      | McpServerRow
      | undefined;
    if (!current) {
      throw new Error(`No MCP server found with id: ${id}`);
    }

    db.prepare(
      `UPDATE mcp_server SET name = ?, command = ?, args = ?, url = ?, headers = ?, purpose = ? WHERE id = ?`,
    ).run(
      input.name ?? current.name,
      input.command !== undefined ? input.command : current.command,
      input.args !== undefined ? serializeJson(input.args) : current.args,
      input.url !== undefined ? input.url : current.url,
      input.headers !== undefined ? serializeJson(input.headers) : current.headers,
      input.purpose !== undefined ? input.purpose : current.purpose,
      id,
    );

    const deleteByKey = db.prepare('DELETE FROM secret WHERE mcp_server_id = ? AND env_key = ?');
    for (const envKey of input.removeSecretKeys ?? []) {
      deleteByKey.run(id, envKey);
    }
    if (input.secrets) {
      for (const secret of input.secrets) {
        deleteByKey.run(id, secret.envKey);
      }
      insertSecretRows(db, id, input.secrets);
    }
  });
}

/** Removes the server row and all of its secret rows. */
export function deleteServer(db: Database.Database, id: string): void {
  withTransaction(db, () => {
    db.prepare('DELETE FROM secret WHERE mcp_server_id = ?').run(id);
    db.prepare('DELETE FROM mcp_server WHERE id = ?').run(id);
  });
}

/** Bare server row (no secret flags) for existence/duplicate-name checks. */
export function findByName(db: Database.Database, name: string): McpServerRecord | null {
  const row = db.prepare('SELECT * FROM mcp_server WHERE name = ?').get(name) as
    | McpServerRow
    | undefined;
  return row ? mapServerRow(row) : null;
}

/** Raw sealed {envKey,iv,tag,ciphertext} rows for the resolver/decrypt path
 * (T54) -- never exposed via listServers/getServer. */
export function listSealedSecrets(db: Database.Database, mcpServerId: string): SealedSecretRow[] {
  const rows = db
    .prepare('SELECT * FROM secret WHERE mcp_server_id = ?')
    .all(mcpServerId) as SecretRow[];
  return rows.map((row) => ({
    id: row.id,
    mcpServerId: row.mcp_server_id,
    envKey: row.env_key,
    iv: row.iv,
    tag: row.tag,
    ciphertext: row.ciphertext,
  }));
}

/** Scoped, sanitized read for the gateway's discovery tools: returns only
 * `{id, slug, name, purpose}` for the given ids -- never
 * command/args/url/headers/secrets (SEC-10). Unknown ids are silently
 * ignored rather than erroring, since a stale assignment shouldn't break
 * the whole scoped list. */
export function listScopedByIds(db: Database.Database, ids: string[]): ScopedMcp[] {
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT id, slug, name, purpose FROM mcp_server WHERE id IN (${placeholders})`)
    .all(...ids) as Array<{ id: string; slug: string; name: string; purpose: string | null }>;
  return rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, purpose: row.purpose }));
}
