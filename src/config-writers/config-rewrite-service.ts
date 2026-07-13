import type Database from 'better-sqlite3';
import * as assignmentsRepository from '../domain/assignments/assignments-repository.js';
import * as consumersRepository from '../domain/consumers/consumers-repository.js';
import type { ClientFormat, ConsumerRecord } from '../domain/consumers/consumer-types.js';
import * as claudeCodeWriter from './claude-code-writer.js';
import * as codexWriter from './codex-writer.js';
import * as cursorWriter from './cursor-writer.js';
import * as vscodeWriter from './vscode-writer.js';
import type { ConfigWriter, WriteConfigResult } from './writer-interface.js';

/**
 * Writer registry keyed by client format (desktop-profile shims are a
 * separate P2 addition of the same `ConfigWriter` shape, added here when
 * they land).
 */
const DEFAULT_WRITERS: Partial<Record<ClientFormat, ConfigWriter>> = {
  'claude-code': claudeCodeWriter,
  cursor: cursorWriter,
  vscode: vscodeWriter,
  codex: codexWriter,
};

/** CFG-D2: retro-compat default when a consumer has no explicit
 * clientFormats selected -- preserves the P1 behavior where every
 * discovered/registered project got its Claude Code config written. */
const DEFAULT_CLIENT_FORMATS: ClientFormat[] = ['claude-code'];

export interface ConfigRewriteServiceDeps {
  db: Database.Database;
  /** Reachable base for the gateway (host-published address), always
   * supplied by the caller -- never read from env here. */
  gatewayBaseUrl: string;
  /** Injectable for tests; defaults to the production writer registry. */
  writers?: Partial<Record<ClientFormat, ConfigWriter>>;
}

/**
 * CFG-D1..D3: rewrites the native client config(s) for each given consumer.
 * Per consumer, resolves its current `allowedMcpIds` scope (0 assignments
 * still triggers a writeConfig call so the writer can clean up its managed
 * entry) and dispatches only to the writers matching the consumer's own
 * `clientFormats` selection -- NOT every registered writer. An empty
 * `clientFormats` (never explicitly set) defaults to `['claude-code']` for
 * retro-compatibility with P1-registered/discovered projects (CFG-D2). A
 * format with no matching entry in the writer registry is silently skipped
 * (e.g. a stale/unsupported format value).
 *
 * Only `project` consumers are dispatched to a writer today -- Claude
 * Desktop profiles get their `mcpServers` shim block from a P2 writer that
 * doesn't exist yet, so a desktop-profile consumer intentionally produces
 * no results here rather than being (incorrectly) handed to a project
 * config writer.
 *
 * Each writer call is isolated in try/catch so one format's failure never
 * aborts the batch (CFG-D3); the `ConfigWriter` contract itself already
 * returns `status:'error'` instead of throwing, so this catch is a
 * defense-in-depth guard against a writer that violates that contract.
 */
export async function rewriteConfigsForConsumers(
  deps: ConfigRewriteServiceDeps,
  consumerIds: string[],
): Promise<WriteConfigResult[]> {
  const writers = deps.writers ?? DEFAULT_WRITERS;
  const results: WriteConfigResult[] = [];

  for (const consumerId of consumerIds) {
    const consumer = consumersRepository.getConsumer(deps.db, consumerId);
    if (!consumer || consumer.type !== 'project') {
      continue;
    }

    const hasAssignments =
      assignmentsRepository.allowedMcpIds(deps.db, consumerId).length > 0;

    const formats =
      consumer.clientFormats.length > 0 ? consumer.clientFormats : DEFAULT_CLIENT_FORMATS;

    for (const format of formats) {
      const writer = writers[format];
      if (!writer) {
        continue;
      }
      results.push(await runWriter(writer, format, consumer, deps.gatewayBaseUrl, hasAssignments));
    }
  }

  return results;
}

async function runWriter(
  writer: ConfigWriter,
  format: ClientFormat,
  consumer: ConsumerRecord,
  gatewayBaseUrl: string,
  hasAssignments: boolean,
): Promise<WriteConfigResult> {
  try {
    return await writer.writeConfig(consumer, gatewayBaseUrl, hasAssignments);
  } catch (err) {
    return {
      consumerId: consumer.id,
      format,
      path: consumer.path,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
