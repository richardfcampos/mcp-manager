import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MANAGED_KEY } from './managed-block.js';
import { writeConfig } from './cursor-writer.js';
import type { ConsumerRecord } from '../domain/consumers/consumer-types.js';

const GATEWAY_BASE_URL = 'http://127.0.0.1:4317';

function buildConsumer(path: string, overrides: Partial<ConsumerRecord> = {}): ConsumerRecord {
  return {
    id: 'consumer-1',
    type: 'project',
    name: 'my-project',
    path,
    token: 'tok-abc123',
    clientFormats: ['cursor'],
    discovered: false,
    available: true,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function readMcpJson(path: string): unknown {
  return JSON.parse(readFileSync(join(path, '.cursor', 'mcp.json'), 'utf-8'));
}

describe('cursor-writer', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-manager-cursor-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('CFG-C1: writes .cursor/mcp.json (creating the .cursor dir) with the correct shape', async () => {
    const consumer = buildConsumer(projectDir);

    const result = await writeConfig(consumer, GATEWAY_BASE_URL, true);

    expect(result).toMatchObject({
      consumerId: 'consumer-1',
      format: 'cursor',
      path: join(projectDir, '.cursor', 'mcp.json'),
      status: 'written',
    });

    const config = readMcpJson(projectDir) as { mcpServers: Record<string, unknown> };
    expect(config.mcpServers[MANAGED_KEY]).toEqual({
      type: 'http',
      url: `${GATEWAY_BASE_URL}/mcp/tok-abc123`,
      headers: { Authorization: 'Bearer tok-abc123' },
    });
  });

  it('CFG-C1: preserves unrelated existing .cursor/mcp.json entries', async () => {
    mkdirSync(join(projectDir, '.cursor'), { recursive: true });
    writeFileSync(
      join(projectDir, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'user-mcp': { command: 'npx', args: ['user-tool'] } } }),
    );
    const consumer = buildConsumer(projectDir);

    await writeConfig(consumer, GATEWAY_BASE_URL, true);

    const config = readMcpJson(projectDir) as { mcpServers: Record<string, unknown> };
    expect(config.mcpServers['user-mcp']).toEqual({ command: 'npx', args: ['user-tool'] });
    expect(config.mcpServers[MANAGED_KEY]).toBeDefined();
  });

  it('CFG-C2: a second identical write is idempotent (status unchanged, no rewrite)', async () => {
    const consumer = buildConsumer(projectDir);

    await writeConfig(consumer, GATEWAY_BASE_URL, true);
    const beforeContent = readFileSync(join(projectDir, '.cursor', 'mcp.json'), 'utf-8');

    const second = await writeConfig(consumer, GATEWAY_BASE_URL, true);

    expect(second.status).toBe('unchanged');
    expect(readFileSync(join(projectDir, '.cursor', 'mcp.json'), 'utf-8')).toBe(beforeContent);
  });

  it('CFG-C3: 0 assignments removes the managed entry, preserving other entries', async () => {
    const consumer = buildConsumer(projectDir);
    await writeConfig(consumer, GATEWAY_BASE_URL, true);
    const configFile = join(projectDir, '.cursor', 'mcp.json');
    const current = JSON.parse(readFileSync(configFile, 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    current.mcpServers['user-mcp'] = { command: 'npx' };
    writeFileSync(configFile, JSON.stringify(current));

    const result = await writeConfig(consumer, GATEWAY_BASE_URL, false);

    expect(result.status).toBe('removed');
    const config = readMcpJson(projectDir) as { mcpServers: Record<string, unknown> };
    expect(config.mcpServers[MANAGED_KEY]).toBeUndefined();
    expect(config.mcpServers['user-mcp']).toEqual({ command: 'npx' });
  });

  it('CFG-C3: cleanup on a project with no config file creates nothing (no stub)', async () => {
    const consumer = buildConsumer(projectDir);

    const result = await writeConfig(consumer, GATEWAY_BASE_URL, false);

    expect(result.status).toBe('unchanged');
    expect(existsSync(join(projectDir, '.cursor', 'mcp.json'))).toBe(false);
  });

  it('CFG-C3: cleanup leaves a user file without the managed entry byte-identical (no reformat)', async () => {
    mkdirSync(join(projectDir, '.cursor'), { recursive: true });
    const userContent = '{"mcpServers":{"user-mcp":{"command":"npx"}}}';
    writeFileSync(join(projectDir, '.cursor', 'mcp.json'), userContent);
    const consumer = buildConsumer(projectDir);

    const result = await writeConfig(consumer, GATEWAY_BASE_URL, false);

    expect(result.status).toBe('unchanged');
    expect(readFileSync(join(projectDir, '.cursor', 'mcp.json'), 'utf-8')).toBe(userContent);
  });

  it('CFG-C4: an unwritable project path returns status:error and does not throw', async () => {
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
