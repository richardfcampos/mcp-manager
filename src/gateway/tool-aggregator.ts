const PREFIX_SEPARATOR = '__';

/** A tool as returned by an upstream Client.listTools(), aggregated here
 * with its name rewritten to `<slug>__<tool>`. Kept loosely typed
 * (Record-based) because tool shapes are arbitrary, upstream-defined data
 * proxied verbatim -- only `name` is guaranteed by this module. */
export interface AggregatedTool {
  name: string;
  [key: string]: unknown;
}

export interface UpstreamClientLike {
  listTools(): Promise<{ tools: Array<{ name: string; [key: string]: unknown }> }>;
  callTool(params: { name: string; arguments?: unknown }): Promise<unknown>;
}

/** The subset of upstream-registry's UpstreamEntry the aggregator needs --
 * kept as a narrow structural interface so unit tests can pass a stubbed
 * registry/client instead of a real one (no spawn, parallel-safe). */
export interface UpstreamEntryLike {
  mcpServer: { id: string; slug: string };
  client: UpstreamClientLike;
}

export interface RegistryLike {
  getClient(mcpServerId: string): Promise<UpstreamEntryLike>;
}

/**
 * GW-01/GW-03: lists tools only for the given `mcpIds`, each name prefixed
 * `<slug>__<tool>` (slug sourced from the registry entry's mcpServer
 * metadata, never a separate DB/repo call) so identically-named tools from
 * different upstreams never collide. An upstream whose getClient/listTools
 * fails is skipped -- the rest still aggregate (isolated failure).
 */
export async function aggregateTools(
  registry: RegistryLike,
  mcpIds: string[],
): Promise<AggregatedTool[]> {
  const aggregated: AggregatedTool[] = [];

  for (const mcpId of mcpIds) {
    try {
      const entry = await registry.getClient(mcpId);
      const { tools } = await entry.client.listTools();
      for (const tool of tools) {
        aggregated.push({ ...tool, name: `${entry.mcpServer.slug}${PREFIX_SEPARATOR}${tool.name}` });
      }
    } catch {
      // GW-03 isolation: a failing upstream is omitted, not fatal.
    }
  }

  return aggregated;
}

/**
 * GW-01/GW-03: strips the `<slug>__` prefix, resolves the slug back to the
 * owning upstream among the caller's scoped `mcpIds` (never a name outside
 * that set), and dispatches `tools/call` to it. A sibling upstream that
 * fails to connect while searching for the matching slug is skipped, not
 * fatal to routing (isolation). Throws when the name isn't prefixed or
 * doesn't match any upstream in scope (not routed).
 */
export async function routeToolCall(
  registry: RegistryLike,
  mcpIds: string[],
  prefixedName: string,
  args: unknown,
): Promise<unknown> {
  const separatorIndex = prefixedName.indexOf(PREFIX_SEPARATOR);
  if (separatorIndex === -1) {
    throw new Error(`Tool name is not prefixed with an MCP slug: ${prefixedName}`);
  }
  const slug = prefixedName.slice(0, separatorIndex);
  const toolName = prefixedName.slice(separatorIndex + PREFIX_SEPARATOR.length);

  for (const mcpId of mcpIds) {
    let entry: UpstreamEntryLike;
    try {
      entry = await registry.getClient(mcpId);
    } catch {
      continue;
    }
    if (entry.mcpServer.slug === slug) {
      return entry.client.callTool({ name: toolName, arguments: args });
    }
  }

  throw new Error(`No MCP in scope matches tool: ${prefixedName}`);
}
