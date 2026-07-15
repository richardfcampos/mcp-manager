import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerListItem, SealedSecretRow } from '../domain/mcp-servers/mcp-server-types.js';

vi.mock('../domain/mcp-servers/mcp-servers-repository.js', () => ({
  getServer: vi.fn(),
  listSealedSecrets: vi.fn(),
}));
vi.mock('../vault/secret-vault.js', () => ({
  openSecret: vi.fn(),
}));

import * as mcpServersRepository from '../domain/mcp-servers/mcp-servers-repository.js';
import { openSecret } from '../vault/secret-vault.js';
import { resolveUpstreamConfig, type UpstreamConfigResolverDeps } from './upstream-config-resolver.js';

const masterKey = Buffer.alloc(32, 7);
// Stubbed dependency injection point (see file-level vi.mock above); this
// resolver's own tests never touch a real Database.
const deps: UpstreamConfigResolverDeps = { db: {} as UpstreamConfigResolverDeps['db'], masterKey };

function fakeServer(overrides: Partial<McpServerListItem> = {}): McpServerListItem {
  return {
    id: 'mcp-1',
    slug: 'demo',
    name: 'Demo',
    transport: 'stdio',
    command: 'node',
    args: [],
    url: null,
    headers: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    secrets: [],
    ...overrides,
  };
}

function fakeSealedRow(overrides: Partial<SealedSecretRow> = {}): SealedSecretRow {
  return {
    id: 'secret-1',
    mcpServerId: 'mcp-1',
    envKey: 'API_KEY',
    iv: 'iv',
    tag: 'tag',
    ciphertext: 'ciphertext',
    ...overrides,
  };
}

describe('upstream-config-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GW-02: builds an envKey->plaintext map from the sealed secret rows, ready for connectUpstream', () => {
    vi.mocked(mcpServersRepository.getServer).mockReturnValue(fakeServer());
    vi.mocked(mcpServersRepository.listSealedSecrets).mockReturnValue([
      fakeSealedRow({ envKey: 'API_KEY' }),
    ]);
    vi.mocked(openSecret).mockReturnValue('plain-value');

    const result = resolveUpstreamConfig(deps, 'mcp-1');

    expect(result.decryptedSecretsEnv).toEqual({ API_KEY: 'plain-value' });
    expect(result.mcpServer.id).toBe('mcp-1');
    expect(openSecret).toHaveBeenCalledWith(
      expect.objectContaining({ envKey: 'API_KEY' }),
      masterKey,
    );
  });

  it('throws a clear error when the mcpServerId has no server row', () => {
    vi.mocked(mcpServersRepository.getServer).mockReturnValue(null);

    expect(() => resolveUpstreamConfig(deps, 'missing')).toThrow(/No MCP server found/);
    expect(mcpServersRepository.listSealedSecrets).not.toHaveBeenCalled();
  });

  it('resolves to an empty decryptedSecretsEnv map for a server with zero sealed secrets', () => {
    vi.mocked(mcpServersRepository.getServer).mockReturnValue(fakeServer({ id: 'mcp-2' }));
    vi.mocked(mcpServersRepository.listSealedSecrets).mockReturnValue([]);

    const result = resolveUpstreamConfig(deps, 'mcp-2');

    expect(result.decryptedSecretsEnv).toEqual({});
    expect(openSecret).not.toHaveBeenCalled();
  });

  it('decrypts every sealed secret row via the vault, keyed by envKey', () => {
    vi.mocked(mcpServersRepository.getServer).mockReturnValue(fakeServer());
    vi.mocked(mcpServersRepository.listSealedSecrets).mockReturnValue([
      fakeSealedRow({ envKey: 'API_KEY', ciphertext: 'ct-1' }),
      fakeSealedRow({ envKey: 'API_SECRET', ciphertext: 'ct-2' }),
    ]);
    vi.mocked(openSecret).mockImplementation((sealed) =>
      sealed.ciphertext === 'ct-1' ? 'value-1' : 'value-2',
    );

    const result = resolveUpstreamConfig(deps, 'mcp-1');

    expect(result.decryptedSecretsEnv).toEqual({ API_KEY: 'value-1', API_SECRET: 'value-2' });
  });
});
