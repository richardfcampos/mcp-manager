import { describe, expect, it, vi } from 'vitest';
import {
  DISCOVERY_TOOL_DEFINITIONS,
  handleListMcps,
  type DiscoveryToolDeps,
  type RegistryLike,
  type UpstreamClientLike,
  type UpstreamEntryLike,
} from './discovery-tools.js';
import type { ScopedMcp } from '../domain/mcp-servers/mcp-server-types.js';

function stubEntry(id: string, slug: string, client: Partial<UpstreamClientLike> = {}): UpstreamEntryLike {
  return {
    mcpServer: { id, slug },
    client: {
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
      ...client,
    },
  };
}

/** Registry stub. Entries are keyed by id; an Error value makes getClient
 * reject for that id (upstream down). A vi.fn() wrapper lets tests assert the
 * registry was (never) contacted. */
function fakeRegistry(entries: Record<string, UpstreamEntryLike | Error>): RegistryLike {
  return {
    getClient: vi.fn(async (mcpServerId: string) => {
      const entry = entries[mcpServerId];
      if (!entry) {
        throw new Error(`no fake entry registered for ${mcpServerId}`);
      }
      if (entry instanceof Error) {
        throw entry;
      }
      return entry;
    }),
  };
}

/** listScopedMcps stub that only returns rows whose id is in the requested
 * scope -- mirroring the repository's listScopedByIds contract. */
function scopedReader(all: ScopedMcp[]) {
  return (ids: string[]): ScopedMcp[] => all.filter((mcp) => ids.includes(mcp.id));
}

function parseMcps(result: { content: Array<{ type: string; text: string }> }): Array<{
  slug: string;
  name: string;
  purpose: string | null;
}> {
  return JSON.parse(result.content[0].text).mcps;
}

describe('discovery-tools', () => {
  describe('DISCOVERY_TOOL_DEFINITIONS', () => {
    it('DISC-01: exposes exactly the 3 meta-tools with object inputSchemas', () => {
      expect(DISCOVERY_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
        'list_mcps',
        'get_mcp_tools',
        'call_mcp_tool',
      ]);
      for (const tool of DISCOVERY_TOOL_DEFINITIONS) {
        expect(tool.inputSchema.type).toBe('object');
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });

    it('requires the mcp/tool identifiers on the tools that need them', () => {
      const byName = Object.fromEntries(DISCOVERY_TOOL_DEFINITIONS.map((t) => [t.name, t]));
      expect(byName.list_mcps.inputSchema.required).toBeUndefined();
      expect(byName.get_mcp_tools.inputSchema.required).toEqual(['mcp']);
      expect(byName.call_mcp_tool.inputSchema.required).toEqual(['mcp', 'tool']);
    });
  });

  describe('handleListMcps', () => {
    it('DISC-02: returns only the consumer-scoped MCPs', async () => {
      const deps: DiscoveryToolDeps = {
        registry: fakeRegistry({}),
        listScopedMcps: scopedReader([
          { id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'do alpha' },
          { id: 'mcp-b', slug: 'b', name: 'Beta', purpose: 'do beta' },
        ]),
      };

      const mcps = parseMcps(await handleListMcps(deps, ['mcp-a']));

      expect(mcps).toEqual([{ slug: 'a', name: 'Alpha', purpose: 'do alpha' }]);
    });

    it('DISC-02: an empty scope yields an empty list, not an error', async () => {
      const deps: DiscoveryToolDeps = {
        registry: fakeRegistry({}),
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'x' }]),
      };

      const mcps = parseMcps(await handleListMcps(deps, []));

      expect(mcps).toEqual([]);
    });

    it('SEC-10: each listed MCP exposes ONLY slug, name and purpose (never id)', async () => {
      const deps: DiscoveryToolDeps = {
        registry: fakeRegistry({}),
        listScopedMcps: scopedReader([{ id: 'secret-id', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const mcps = parseMcps(await handleListMcps(deps, ['secret-id']));

      expect(Object.keys(mcps[0]).sort()).toEqual(['name', 'purpose', 'slug']);
      expect(JSON.stringify(mcps)).not.toContain('secret-id');
    });

    it('DESC-02: a manually authored purpose wins over any upstream probe', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', { getInstructions: () => 'IGNORED upstream text' }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'manual purpose' }]),
      };

      const mcps = parseMcps(await handleListMcps(deps, ['mcp-a']));

      expect(mcps[0].purpose).toBe('manual purpose');
      expect(registry.getClient).not.toHaveBeenCalled();
    });

    it('DESC-02: empty purpose falls back to upstream instructions, truncated to 400 chars', async () => {
      const longInstructions = 'x'.repeat(1000);
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', { getInstructions: () => longInstructions }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: null }]),
      };

      const mcps = parseMcps(await handleListMcps(deps, ['mcp-a']));

      expect(mcps[0].purpose).toBe('x'.repeat(400));
    });

    it('DESC-02: empty purpose with no instructions falls back to the advertised title', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', {
          getInstructions: () => undefined,
          getServerVersion: () => ({ title: 'Alpha Server' }),
        }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: '   ' }]),
      };

      const mcps = parseMcps(await handleListMcps(deps, ['mcp-a']));

      expect(mcps[0].purpose).toBe('Alpha Server');
    });

    it('DISC-07/DESC-02: an unreachable upstream still lists the MCP with purpose null', async () => {
      const registry = fakeRegistry({
        'mcp-down': new Error('spawn /secret/path/uvx ENOENT'),
        'mcp-up': stubEntry('mcp-up', 'up', { getInstructions: () => 'up and running' }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([
          { id: 'mcp-down', slug: 'down', name: 'Down', purpose: null },
          { id: 'mcp-up', slug: 'up', name: 'Up', purpose: null },
        ]),
      };

      const mcps = parseMcps(await handleListMcps(deps, ['mcp-down', 'mcp-up']));

      expect(mcps).toEqual([
        { slug: 'down', name: 'Down', purpose: null },
        { slug: 'up', name: 'Up', purpose: 'up and running' },
      ]);
      // SEC-10: the raw spawn error (which leaks a filesystem path) never
      // surfaces in the response.
      expect(JSON.stringify(mcps)).not.toContain('/secret/path');
    });
  });
});
