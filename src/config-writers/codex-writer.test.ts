import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MANAGED_KEY } from './managed-block.js';
import { writeConfig } from './codex-writer.js';
import type { ConsumerRecord } from '../domain/consumers/consumer-types.js';

const GATEWAY_BASE_URL = 'http://127.0.0.1:4317';

function buildConsumer(path: string, overrides: Partial<ConsumerRecord> = {}): ConsumerRecord {
  return {
    id: 'consumer-1',
    type: 'project',
    name: 'my-project',
    path,
    token: 'tok-abc123',
    clientFormats: ['codex'],
    discovered: false,
    available: true,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function readCodexConfig(path: string): { mcp_servers?: Record<string, unknown>; [key: string]: unknown } {
  return parseToml(readFileSync(join(path, '.codex', 'config.toml'), 'utf-8'));
}

describe('codex-writer', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-manager-codex-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('writes .codex/config.toml (creating the .codex dir) with the mcp_servers gateway table', async () => {
    const consumer = buildConsumer(projectDir);

    const result = await writeConfig(consumer, GATEWAY_BASE_URL, true);

    expect(result).toMatchObject({
      consumerId: 'consumer-1',
      format: 'codex',
      path: join(projectDir, '.codex', 'config.toml'),
      status: 'written',
    });

    const config = readCodexConfig(projectDir);
    expect(config.mcp_servers?.[MANAGED_KEY]).toEqual({
      url: `${GATEWAY_BASE_URL}/mcp/tok-abc123`,
      http_headers: { Authorization: 'Bearer tok-abc123' },
    });
  });

  it('preserves other server tables and top-level Codex settings', async () => {
    mkdirSync(join(projectDir, '.codex'), { recursive: true });
    writeFileSync(
      join(projectDir, '.codex', 'config.toml'),
      [
        'model = "gpt-5-codex"',
        '',
        '[mcp_servers.user-mcp]',
        'command = "npx"',
        'args = ["user-tool"]',
        '',
      ].join('\n'),
    );
    const consumer = buildConsumer(projectDir);

    await writeConfig(consumer, GATEWAY_BASE_URL, true);

    const config = readCodexConfig(projectDir);
    expect(config.model).toBe('gpt-5-codex');
    expect(config.mcp_servers?.['user-mcp']).toEqual({ command: 'npx', args: ['user-tool'] });
    expect(config.mcp_servers?.[MANAGED_KEY]).toBeDefined();
  });

  it('is idempotent: a second identical write reports unchanged with no rewrite', async () => {
    const consumer = buildConsumer(projectDir);
    await writeConfig(consumer, GATEWAY_BASE_URL, true);
    const beforeContent = readFileSync(join(projectDir, '.codex', 'config.toml'), 'utf-8');

    const second = await writeConfig(consumer, GATEWAY_BASE_URL, true);

    expect(second.status).toBe('unchanged');
    expect(readFileSync(join(projectDir, '.codex', 'config.toml'), 'utf-8')).toBe(beforeContent);
  });

  it('0 assignments removes the managed entry, preserving other entries', async () => {
    const consumer = buildConsumer(projectDir);
    await writeConfig(consumer, GATEWAY_BASE_URL, true);
    const configFile = join(projectDir, '.codex', 'config.toml');
    writeFileSync(
      configFile,
      `${readFileSync(configFile, 'utf-8')}\n[mcp_servers.user-mcp]\ncommand = "uvx"\n`,
    );

    const result = await writeConfig(consumer, GATEWAY_BASE_URL, false);

    expect(result.status).toBe('removed');
    const config = readCodexConfig(projectDir);
    expect(config.mcp_servers?.[MANAGED_KEY]).toBeUndefined();
    expect(config.mcp_servers?.['user-mcp']).toEqual({ command: 'uvx' });
  });

  it('cleanup on a project with no config file creates nothing (no stub)', async () => {
    const consumer = buildConsumer(projectDir);

    const result = await writeConfig(consumer, GATEWAY_BASE_URL, false);

    expect(result.status).toBe('unchanged');
    expect(existsSync(join(projectDir, '.codex', 'config.toml'))).toBe(false);
  });

  it('an unwritable project path returns status:error and does not throw', async () => {
    const lockedDir = join(projectDir, 'locked');
    mkdirSync(lockedDir);
    chmodSync(lockedDir, 0o555); // read+execute only -- no write permission

    const consumer = buildConsumer(lockedDir);

    try {
      const result = await writeConfig(consumer, GATEWAY_BASE_URL, true);

      expect(result.status).toBe('error');
      expect(result.error).toBeTruthy();
    } finally {
      chmodSync(lockedDir, 0o755); // restore so afterEach can clean up
    }
  });
});
