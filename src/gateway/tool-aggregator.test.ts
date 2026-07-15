import { describe, expect, it } from 'vitest';
import {
  aggregateTools,
  routeToolCall,
  type RegistryLike,
  type UpstreamEntryLike,
} from './tool-aggregator.js';

function stubEntry(
  id: string,
  slug: string,
  tools: Array<{ name: string; [key: string]: unknown }>,
  callToolResult: unknown = { content: [{ type: 'text', text: `called-by-${slug}` }] },
): UpstreamEntryLike {
  return {
    mcpServer: { id, slug },
    client: {
      listTools: async () => ({ tools }),
      callTool: async (params) => ({ ...(callToolResult as object), calledWith: params }),
    },
  };
}

function fakeRegistry(entries: Record<string, UpstreamEntryLike | Error>): RegistryLike {
  return {
    async getClient(mcpServerId: string) {
      const entry = entries[mcpServerId];
      if (!entry) {
        throw new Error(`no fake entry registered for ${mcpServerId}`);
      }
      if (entry instanceof Error) {
        throw entry;
      }
      return entry;
    },
  };
}

describe('tool-aggregator', () => {
  describe('aggregateTools', () => {
    it('GW-01: returns tools only for the supplied mcpIds, excluding any other server', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', [{ name: 'ping' }]),
        'mcp-b': stubEntry('mcp-b', 'b', [{ name: 'pong' }]),
      });

      const tools = await aggregateTools(registry, ['mcp-a']);

      expect(tools).toHaveLength(1);
      expect(tools.some((tool) => tool.name.startsWith('b__'))).toBe(false);
    });

    it('prefixes every returned tool name with <slug>__<tool>', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', [{ name: 'ping' }, { name: 'echo' }]),
      });

      const tools = await aggregateTools(registry, ['mcp-a']);

      expect(tools.map((tool) => tool.name).sort()).toEqual(['a__echo', 'a__ping']);
    });

    it('disambiguates a name collision across servers (a__search vs b__search)', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', [{ name: 'search' }]),
        'mcp-b': stubEntry('mcp-b', 'b', [{ name: 'search' }]),
      });

      const tools = await aggregateTools(registry, ['mcp-a', 'mcp-b']);

      expect(tools.map((tool) => tool.name).sort()).toEqual(['a__search', 'b__search']);
    });

    it('GW-03: skips an upstream whose listTools throws, still aggregating the rest', async () => {
      const registry = fakeRegistry({
        'mcp-broken': new Error('upstream unreachable'),
        'mcp-healthy': stubEntry('mcp-healthy', 'healthy', [{ name: 'ping' }]),
      });

      const tools = await aggregateTools(registry, ['mcp-broken', 'mcp-healthy']);

      expect(tools.map((tool) => tool.name)).toEqual(['healthy__ping']);
    });
  });

  describe('routeToolCall', () => {
    it('strips the prefix and dispatches tools/call to the correct upstream', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', [{ name: 'ping' }]),
        'mcp-b': stubEntry('mcp-b', 'b', [{ name: 'ping' }]),
      });

      const result = (await routeToolCall(registry, ['mcp-a', 'mcp-b'], 'b__ping', {
        x: 1,
      })) as { calledWith: { name: string; arguments: unknown } };

      expect(result.calledWith).toEqual({ name: 'ping', arguments: { x: 1 } });
    });

    it('rejects a prefixed name outside the scoped mcpIds set (not routed)', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', [{ name: 'ping' }]),
      });

      await expect(routeToolCall(registry, ['mcp-a'], 'outside__ping', {})).rejects.toThrow(
        /No MCP in scope/,
      );
    });

    it('rejects a name with no slug prefix at all', async () => {
      const registry = fakeRegistry({});

      await expect(routeToolCall(registry, [], 'not-prefixed', {})).rejects.toThrow(
        /not prefixed/,
      );
    });

    it('GW-03: skips a sibling upstream that fails to connect while searching for the slug', async () => {
      const registry = fakeRegistry({
        'mcp-broken': new Error('upstream unreachable'),
        'mcp-healthy': stubEntry('mcp-healthy', 'healthy', [{ name: 'ping' }]),
      });

      const result = (await routeToolCall(
        registry,
        ['mcp-broken', 'mcp-healthy'],
        'healthy__ping',
        {},
      )) as { calledWith: { name: string } };

      expect(result.calledWith.name).toBe('ping');
    });
  });
});
