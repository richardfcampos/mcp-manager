import { describe, expect, it, vi } from 'vitest';
import {
  DISCOVERY_TOOL_DEFINITIONS,
  handleDiscoveryToolCall,
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

  describe('handleDiscoveryToolCall dispatch', () => {
    it('routes list_mcps to its handler', async () => {
      const deps: DiscoveryToolDeps = {
        registry: fakeRegistry({}),
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const result = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'list_mcps', undefined)) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(parseMcps(result)).toEqual([{ slug: 'a', name: 'Alpha', purpose: 'p' }]);
    });

    it('returns a tool error (not a throw) for an unknown tool name', async () => {
      const deps: DiscoveryToolDeps = { registry: fakeRegistry({}), listScopedMcps: scopedReader([]) };

      const result = (await handleDiscoveryToolCall(deps, [], 'no_such_tool', {})) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('no_such_tool');
    });

    it('DISC-08: unknown fields are rejected on get_mcp_tools and list_mcps too, registry untouched', async () => {
      const registry = fakeRegistry({ 'mcp-a': stubEntry('mcp-a', 'a') });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const getTools = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'get_mcp_tools', {
        mcp: 'a',
        slug: 'a',
      })) as { isError?: boolean; content: Array<{ text: string }> };
      const listMcps = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'list_mcps', {
        filter: 'x',
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(getTools.isError).toBe(true);
      expect(getTools.content[0].text).toContain('"slug"');
      expect(getTools.content[0].text).toContain('mcp');
      expect(listMcps.isError).toBe(true);
      expect(listMcps.content[0].text).toContain('"filter"');
      expect(registry.getClient).not.toHaveBeenCalled();
    });

    it('list_mcps accepts both an empty object and no arguments at all', async () => {
      const deps: DiscoveryToolDeps = {
        registry: fakeRegistry({}),
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const withEmpty = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'list_mcps', {})) as {
        content: Array<{ type: string; text: string }>;
      };
      const withNothing = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'list_mcps', undefined)) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(parseMcps(withEmpty)).toEqual([{ slug: 'a', name: 'Alpha', purpose: 'p' }]);
      expect(parseMcps(withNothing)).toEqual([{ slug: 'a', name: 'Alpha', purpose: 'p' }]);
    });
  });

  describe('get_mcp_tools', () => {
    it('DISC-03: returns the scoped MCP tools with ORIGINAL names, description and inputSchema', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', {
          listTools: async () => ({
            tools: [{ name: 'search', description: 'find things', inputSchema: { type: 'object' } }],
          }),
        }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const result = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'get_mcp_tools', { mcp: 'a' })) as {
        content: Array<{ text: string }>;
      };
      const payload = JSON.parse(result.content[0].text);

      expect(payload).toEqual({
        mcp: 'a',
        tools: [{ name: 'search', description: 'find things', inputSchema: { type: 'object' } }],
      });
    });

    it('edge: identically-named tools on different MCPs are disambiguated by which mcp is asked', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', { listTools: async () => ({ tools: [{ name: 'search' }] }) }),
        'mcp-b': stubEntry('mcp-b', 'b', { listTools: async () => ({ tools: [{ name: 'search' }] }) }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([
          { id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' },
          { id: 'mcp-b', slug: 'b', name: 'Beta', purpose: 'p' },
        ]),
      };

      const result = (await handleDiscoveryToolCall(deps, ['mcp-a', 'mcp-b'], 'get_mcp_tools', {
        mcp: 'a',
      })) as { content: Array<{ text: string }> };

      expect(JSON.parse(result.content[0].text).mcp).toBe('a');
    });

    it('DISC-05: an out-of-scope slug and a nonexistent slug produce the identical opaque error, registry untouched', async () => {
      const scoped = scopedReader([{ id: 'mine', slug: 'mine', name: 'Mine', purpose: 'p' }]);
      // 'jira' belongs to another consumer here, but that upstream is never
      // resolved because scope resolution reads the DB, not the registry.
      const registryWithOther = fakeRegistry({ 'other-id': stubEntry('other-id', 'jira') });
      const registryEmpty = fakeRegistry({});

      const outOfScope = (await handleDiscoveryToolCall(
        { registry: registryWithOther, listScopedMcps: scoped },
        ['mine'],
        'get_mcp_tools',
        { mcp: 'jira' },
      )) as { isError?: boolean; content: Array<{ text: string }> };
      const nonexistent = (await handleDiscoveryToolCall(
        { registry: registryEmpty, listScopedMcps: scoped },
        ['mine'],
        'get_mcp_tools',
        { mcp: 'jira' },
      )) as { isError?: boolean; content: Array<{ text: string }> };

      expect(outOfScope.isError).toBe(true);
      expect(outOfScope.content[0].text).toBe(nonexistent.content[0].text);
      expect(registryWithOther.getClient).not.toHaveBeenCalled();
      expect(registryEmpty.getClient).not.toHaveBeenCalled();
    });

    it('DISC-07/SEC-10: an unreachable upstream yields the sanitized reach error (no raw path)', async () => {
      const registry = fakeRegistry({ 'mcp-a': new Error('spawn /secret/path/uvx ENOENT') });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const result = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'get_mcp_tools', { mcp: 'a' })) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Failed to reach MCP "a"');
      expect(JSON.stringify(result)).not.toContain('/secret/path');
    });
  });

  describe('call_mcp_tool', () => {
    it('DISC-04: forwards args verbatim as the upstream arguments and returns its result verbatim', async () => {
      const upstreamResult = { content: [{ type: 'text', text: 'done' }], structuredContent: { ok: true } };
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', {
          callTool: async (params) => ({ ...upstreamResult, calledWith: params }),
        }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const result = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'call_mcp_tool', {
        mcp: 'a',
        tool: 'search',
        args: { q: 'hi' },
      })) as typeof upstreamResult & { calledWith: { name: string; arguments: unknown } };

      expect(result.calledWith).toEqual({ name: 'search', arguments: { q: 'hi' } });
      expect(result.structuredContent).toEqual({ ok: true });
    });

    it('DISC-04: the call_mcp_tool schema declares args (not arguments), which would collide with the tools/call envelope', () => {
      const callTool = DISCOVERY_TOOL_DEFINITIONS.find((tool) => tool.name === 'call_mcp_tool');
      const properties = callTool?.inputSchema.properties as Record<string, unknown>;

      expect(Object.keys(properties).sort()).toEqual(['args', 'mcp', 'tool']);
      // The description must steer the calling AI to the real field name --
      // it is the only contract an AI reads before building the payload.
      expect(callTool?.description).toContain('"args"');
    });

    it('DISC-09: an omitted args forwards {} to the upstream, never undefined', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', {
          callTool: async (params) => ({ calledWith: params }),
        }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const result = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'call_mcp_tool', {
        mcp: 'a',
        tool: 'search',
      })) as { calledWith: { name: string; arguments: unknown } };

      expect(result.calledWith).toEqual({ name: 'search', arguments: {} });
      // Explicitly not undefined: forwarding undefined made the upstream reject
      // the envelope itself ("expected object") instead of naming the missing
      // parameter.
      expect(result.calledWith.arguments).not.toBeUndefined();
    });

    it('DISC-08: an unknown top-level field is rejected naming both it and args, without touching the registry', async () => {
      const registry = fakeRegistry({ 'mcp-a': stubEntry('mcp-a', 'a') });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const result = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'call_mcp_tool', {
        mcp: 'a',
        tool: 'search',
        input: { q: 'hi' },
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('"input"');
      expect(result.content[0].text).toContain('args');
      expect(registry.getClient).not.toHaveBeenCalled();
    });

    it('DISC-08: the old field name "arguments" is now unknown and must NOT silently pass as no-arguments', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', { callTool: async (params) => ({ calledWith: params }) }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const result = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'call_mcp_tool', {
        mcp: 'a',
        tool: 'search',
        arguments: { q: 'hi' },
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('"arguments"');
      expect(result.content[0].text).toContain('args');
      // The regression: a stray field must never reach the upstream as an
      // argument-less call.
      expect(registry.getClient).not.toHaveBeenCalled();
    });

    it('DISC-08: every unknown field is named, not just the first', async () => {
      const registry = fakeRegistry({ 'mcp-a': stubEntry('mcp-a', 'a') });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const result = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'call_mcp_tool', {
        mcp: 'a',
        tool: 'search',
        input: {},
        params: {},
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('"input"');
      expect(result.content[0].text).toContain('"params"');
      expect(registry.getClient).not.toHaveBeenCalled();
    });

    it('edge: a nonexistent tool on a valid MCP proxies the upstream isError result verbatim', async () => {
      const upstreamError = { content: [{ type: 'text', text: 'Unknown tool: nope' }], isError: true };
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', { callTool: async () => upstreamError }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const result = await handleDiscoveryToolCall(deps, ['mcp-a'], 'call_mcp_tool', {
        mcp: 'a',
        tool: 'nope',
      });

      expect(result).toEqual(upstreamError);
    });

    it('edge: identically-named tools route to the correct upstream by the {mcp, tool} pair', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', {
          callTool: async (params) => ({ from: 'a', calledWith: params }),
        }),
        'mcp-b': stubEntry('mcp-b', 'b', {
          callTool: async (params) => ({ from: 'b', calledWith: params }),
        }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([
          { id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' },
          { id: 'mcp-b', slug: 'b', name: 'Beta', purpose: 'p' },
        ]),
      };

      const toB = (await handleDiscoveryToolCall(deps, ['mcp-a', 'mcp-b'], 'call_mcp_tool', {
        mcp: 'b',
        tool: 'search',
      })) as { from: string };

      expect(toB.from).toBe('b');
    });

    it('DISC-06: a malformed payload is rejected naming the bad field, without touching the registry', async () => {
      const registry = fakeRegistry({ 'mcp-a': stubEntry('mcp-a', 'a') });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const missingMcp = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'call_mcp_tool', {
        tool: 'search',
      })) as { isError?: boolean; content: Array<{ text: string }> };
      const missingTool = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'call_mcp_tool', {
        mcp: 'a',
      })) as { isError?: boolean; content: Array<{ text: string }> };
      const badArgs = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'call_mcp_tool', {
        mcp: 'a',
        tool: 'search',
        args: [1, 2, 3],
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(missingMcp.isError).toBe(true);
      expect(missingMcp.content[0].text).toContain('"mcp"');
      expect(missingTool.isError).toBe(true);
      expect(missingTool.content[0].text).toContain('"tool"');
      expect(badArgs.isError).toBe(true);
      expect(badArgs.content[0].text).toContain('"args"');
      expect(registry.getClient).not.toHaveBeenCalled();
    });

    it('DISC-05: an out-of-scope slug is rejected opaquely without touching the registry', async () => {
      const registry = fakeRegistry({ 'other-id': stubEntry('other-id', 'jira') });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mine', slug: 'mine', name: 'Mine', purpose: 'p' }]),
      };

      const result = (await handleDiscoveryToolCall(deps, ['mine'], 'call_mcp_tool', {
        mcp: 'jira',
        tool: 'search',
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('MCP "jira" is not available for this consumer');
      expect(registry.getClient).not.toHaveBeenCalled();
    });

    it('SEC-10/DISC-07: a thrown upstream call is sanitized, the raw path never appears', async () => {
      const registry = fakeRegistry({
        'mcp-a': stubEntry('mcp-a', 'a', {
          callTool: async () => {
            throw new Error('spawn /secret/path/uvx ENOENT');
          },
        }),
      });
      const deps: DiscoveryToolDeps = {
        registry,
        listScopedMcps: scopedReader([{ id: 'mcp-a', slug: 'a', name: 'Alpha', purpose: 'p' }]),
      };

      const result = (await handleDiscoveryToolCall(deps, ['mcp-a'], 'call_mcp_tool', {
        mcp: 'a',
        tool: 'search',
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Failed to reach MCP "a"');
      expect(JSON.stringify(result)).not.toContain('/secret/path');
    });
  });
});
