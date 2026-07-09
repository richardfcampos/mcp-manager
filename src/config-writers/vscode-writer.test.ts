import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MANAGED_KEY } from './managed-block.js';
import { writeConfig } from './vscode-writer.js';
import type { ConsumerRecord } from '../domain/consumers/consumer-types.js';

const GATEWAY_BASE_URL = 'http://127.0.0.1:4317';

function buildConsumer(path: string, overrides: Partial<ConsumerRecord> = {}): ConsumerRecord {
  return {
    id: 'consumer-1',
    type: 'project',
    name: 'my-project',
    path,
    token: 'tok-abc123',
    clientFormats: ['vscode'],
    discovered: false,
    available: true,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function readMcpJson(path: string): unknown {
  return JSON.parse(readFileSync(join(path, '.vscode', 'mcp.json'), 'utf-8'));
}

describe('vscode-writer', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-manager-vscode-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('CFG-V1: writes .vscode/mcp.json (creating the .vscode dir) under the top-level `servers` key', async () => {
    const consumer = buildConsumer(projectDir);

    const result = await writeConfig(consumer, GATEWAY_BASE_URL, true);

    expect(result).toMatchObject({
      consumerId: 'consumer-1',
      format: 'vscode',
      path: join(projectDir, '.vscode', 'mcp.json'),
      status: 'written',
    });

    const config = readMcpJson(projectDir) as { servers: Record<string, unknown> };
    expect(config.servers[MANAGED_KEY]).toEqual({
      type: 'http',
      url: `${GATEWAY_BASE_URL}/mcp/tok-abc123`,
      headers: { Authorization: 'Bearer tok-abc123' },
    });
    // The top-level key must be `servers`, never `mcpServers`.
    expect((config as Record<string, unknown>).mcpServers).toBeUndefined();
  });

  it('CFG-V1: preserves other top-level keys (inputs, sandbox) and other server entries', async () => {
    mkdirSync(join(projectDir, '.vscode'), { recursive: true });
    writeFileSync(
      join(projectDir, '.vscode', 'mcp.json'),
      JSON.stringify({
        inputs: [{ id: 'api-key', type: 'promptString' }],
        sandbox: { enabled: true },
        servers: { 'user-mcp': { command: 'npx', args: ['user-tool'] } },
      }),
    );
    const consumer = buildConsumer(projectDir);

    await writeConfig(consumer, GATEWAY_BASE_URL, true);

    const config = readMcpJson(projectDir) as {
      inputs: unknown;
      sandbox: unknown;
      servers: Record<string, unknown>;
    };
    expect(config.inputs).toEqual([{ id: 'api-key', type: 'promptString' }]);
    expect(config.sandbox).toEqual({ enabled: true });
    expect(config.servers['user-mcp']).toEqual({ command: 'npx', args: ['user-tool'] });
    expect(config.servers[MANAGED_KEY]).toBeDefined();
  });

  it('CFG-V2: a second identical write is idempotent (status unchanged, no rewrite)', async () => {
    const consumer = buildConsumer(projectDir);

    await writeConfig(consumer, GATEWAY_BASE_URL, true);
    const beforeContent = readFileSync(join(projectDir, '.vscode', 'mcp.json'), 'utf-8');

    const second = await writeConfig(consumer, GATEWAY_BASE_URL, true);

    expect(second.status).toBe('unchanged');
    expect(readFileSync(join(projectDir, '.vscode', 'mcp.json'), 'utf-8')).toBe(beforeContent);
  });

  it('CFG-V2: 0 assignments removes the managed entry, preserving other entries', async () => {
    const consumer = buildConsumer(projectDir);
    await writeConfig(consumer, GATEWAY_BASE_URL, true);
    const configFile = join(projectDir, '.vscode', 'mcp.json');
    const current = JSON.parse(readFileSync(configFile, 'utf-8')) as {
      servers: Record<string, unknown>;
    };
    current.servers['user-mcp'] = { command: 'npx' };
    writeFileSync(configFile, JSON.stringify(current));

    const result = await writeConfig(consumer, GATEWAY_BASE_URL, false);

    expect(result.status).toBe('removed');
    const config = readMcpJson(projectDir) as { servers: Record<string, unknown> };
    expect(config.servers[MANAGED_KEY]).toBeUndefined();
    expect(config.servers['user-mcp']).toEqual({ command: 'npx' });
  });

  it('CFG-V2: an unwritable project path returns status:error and does not throw', async () => {
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
