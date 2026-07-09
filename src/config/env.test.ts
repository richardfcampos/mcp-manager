import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

const validMasterKey = randomBytes(32).toString('base64');
const createdDirs: string[] = [];

function makeTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-manager-env-test-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  createdDirs.length = 0;
});

describe('loadConfig', () => {
  it('throws a clear error when MCP_MANAGER_MASTER_KEY is missing', () => {
    const env = { MCP_MANAGER_WORKSPACE_ROOT: makeTempWorkspace() };

    expect(() => loadConfig(env)).toThrowError(/MCP_MANAGER_MASTER_KEY/);
  });

  it('throws when the master key does not decode to exactly 32 bytes', () => {
    const tooShort = Buffer.from('not-32-bytes').toString('base64');
    const env = {
      MCP_MANAGER_MASTER_KEY: tooShort,
      MCP_MANAGER_WORKSPACE_ROOT: makeTempWorkspace(),
    };

    expect(() => loadConfig(env)).toThrowError(/32 bytes/);
  });

  it('returns a parsed config for a valid 32-byte key', () => {
    const workspaceRoot = makeTempWorkspace();
    const env = {
      MCP_MANAGER_MASTER_KEY: validMasterKey,
      MCP_MANAGER_WORKSPACE_ROOT: workspaceRoot,
    };

    const config = loadConfig(env);

    expect(config.masterKey).toBeInstanceOf(Buffer);
    expect(config.masterKey.length).toBe(32);
    expect(config.workspaceRoot).toBe(resolve(workspaceRoot));
  });

  it('resolves the workspace root from MCP_MANAGER_WORKSPACE_ROOT and falls back to a default', () => {
    const workspaceRoot = makeTempWorkspace();
    const withOverride = loadConfig({
      MCP_MANAGER_MASTER_KEY: validMasterKey,
      MCP_MANAGER_WORKSPACE_ROOT: workspaceRoot,
    });
    expect(withOverride.workspaceRoot).toBe(resolve(workspaceRoot));
    expect(existsSync(withOverride.workspaceRoot)).toBe(true);

    const withDefault = loadConfig({ MCP_MANAGER_MASTER_KEY: validMasterKey });
    expect(withDefault.workspaceRoot).toBe(resolve(process.cwd()));
  });

  it('defaults to a loopback bind host and a default port; PORT/HOST are both overridable', () => {
    const workspaceRoot = makeTempWorkspace();

    const withDefaults = loadConfig({
      MCP_MANAGER_MASTER_KEY: validMasterKey,
      MCP_MANAGER_WORKSPACE_ROOT: workspaceRoot,
    });
    expect(withDefaults.port).toBe(3000);
    expect(withDefaults.host).toBe('127.0.0.1');

    // HOST=0.0.0.0 is only ever set internally by the Dockerfile (container
    // bridge networking); the real "never leaves localhost" guarantee is
    // enforced one layer out, by docker-compose publishing the port on
    // 127.0.0.1 only.
    const withOverrides = loadConfig({
      MCP_MANAGER_MASTER_KEY: validMasterKey,
      MCP_MANAGER_WORKSPACE_ROOT: workspaceRoot,
      PORT: '4100',
      HOST: '0.0.0.0',
    });
    expect(withOverrides.port).toBe(4100);
    expect(withOverrides.host).toBe('0.0.0.0');
  });
});
