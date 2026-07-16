import type { ScopedMcp } from '../domain/mcp-servers/mcp-server-types.js';

/** Longest fallback description list_mcps will emit when it derives a MCP's
 * purpose from the upstream's announced instructions -- a hard cap so a
 * server advertising giant instructions can't re-flood the AI's context
 * (the whole reason we stopped flattening tools). */
const PURPOSE_FALLBACK_MAX_CHARS = 400;

/** The subset of an upstream Client this module touches. `getInstructions`
 * and `getServerVersion` are synchronous accessors populated from the
 * upstream's initialize response (present on the SDK Client); kept optional
 * so test stubs that only exercise listTools/callTool need not provide them.
 * Defined locally as a narrow structural interface so this module stays
 * decoupled from the concrete registry/SDK types. */
export interface UpstreamClientLike {
  getInstructions?(): string | undefined;
  getServerVersion?(): { title?: string } | undefined;
  listTools(): Promise<{
    tools: Array<{ name: string; description?: string; inputSchema?: unknown; [key: string]: unknown }>;
  }>;
  callTool(params: { name: string; arguments?: unknown }): Promise<unknown>;
}

/** The subset of upstream-registry's UpstreamEntry the discovery tools need
 * -- narrow so unit tests can pass a stubbed registry/client (no spawn,
 * parallel-safe). */
export interface UpstreamEntryLike {
  mcpServer: { id: string; slug: string };
  client: UpstreamClientLike;
}

export interface RegistryLike {
  getClient(mcpServerId: string): Promise<UpstreamEntryLike>;
}

/** Dependencies the discovery handlers close over. `listScopedMcps` is the
 * sanitized DB read (only `{id, slug, name, purpose}` -- never
 * command/args/url/headers/secrets, SEC-10); the registry is the lazy-connect
 * upstream pool. */
export interface DiscoveryToolDeps {
  registry: RegistryLike;
  listScopedMcps(ids: string[]): ScopedMcp[];
}

/** A meta-tool definition as returned by the gateway's tools/list. inputSchema
 * is a plain JSON Schema object (no Zod) to match the low-level Server
 * pattern used by the gateway. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP tool-call result this module constructs. Upstream results proxied
 * verbatim by call_mcp_tool are returned as-is (typed `unknown`), so they are
 * not forced through this shape. */
export interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * The 3 fixed meta-tools the gateway exposes instead of flattening every
 * upstream tool (DISC-01). Descriptions deliberately teach the calling AI the
 * discovery flow -- list to see what exists and what each MCP is for, get to
 * load one MCP's tools, call to execute -- so it pulls only what a task needs.
 */
export const DISCOVERY_TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: 'list_mcps',
    description:
      'List every MCP server this consumer can use. Returns each MCP as {slug, name, purpose}, where purpose explains what the MCP is for. Call this FIRST to discover what is available and pick the MCP that fits your task; then use get_mcp_tools on the slug you chose.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_mcp_tools',
    description:
      'List the tools of ONE MCP server, identified by its slug (from list_mcps). Returns each tool with its original name, description and inputSchema. Call this after list_mcps to load only the tools you actually need, then invoke one with call_mcp_tool.',
    inputSchema: {
      type: 'object',
      properties: {
        mcp: { type: 'string', description: 'Slug of the MCP server, exactly as returned by list_mcps.' },
      },
      required: ['mcp'],
      additionalProperties: false,
    },
  },
  {
    name: 'call_mcp_tool',
    description:
      'Invoke a tool on a specific MCP server. Provide the MCP slug (from list_mcps), the tool name (from get_mcp_tools) and the tool arguments. The call is forwarded to the upstream MCP and its result returned verbatim.',
    inputSchema: {
      type: 'object',
      properties: {
        mcp: { type: 'string', description: 'Slug of the MCP server, exactly as returned by list_mcps.' },
        tool: { type: 'string', description: 'Tool name, exactly as returned by get_mcp_tools (no slug prefix).' },
        arguments: {
          type: 'object',
          description: 'Arguments object for the tool, matching its inputSchema. Omit if the tool takes none.',
          additionalProperties: true,
        },
      },
      required: ['mcp', 'tool'],
      additionalProperties: false,
    },
  },
];

/** Serializes a payload as the JSON text content MCP clients expect. */
function jsonResult(payload: unknown): ToolCallResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/**
 * Resolves the description shown for a MCP in list_mcps (DESC-02): a manually
 * authored `purpose` always wins; when empty, we try the upstream's announced
 * instructions (truncated), then its advertised title. ANY failure -- the
 * upstream refusing to connect, throwing on getClient, etc. -- yields `null`
 * so the MCP is still listed (DISC-07): list_mcps must never fail because an
 * upstream is down.
 */
async function resolvePurpose(registry: RegistryLike, mcp: ScopedMcp): Promise<string | null> {
  if (mcp.purpose && mcp.purpose.trim().length > 0) {
    return mcp.purpose;
  }
  try {
    const entry = await registry.getClient(mcp.id);
    const instructions = entry.client.getInstructions?.();
    if (instructions && instructions.trim().length > 0) {
      return instructions.slice(0, PURPOSE_FALLBACK_MAX_CHARS);
    }
    const title = entry.client.getServerVersion?.()?.title;
    return title && title.trim().length > 0 ? title : null;
  } catch {
    return null;
  }
}

/**
 * list_mcps (DISC-02): returns only the MCPs assigned to this consumer, each
 * projected down to exactly {slug, name, purpose} -- never id, command, args
 * or any secret material (SEC-10). An empty scope yields {mcps: []}, not an
 * error. Purpose is filled per-MCP via resolvePurpose (manual value, else an
 * isolated upstream probe).
 */
export async function handleListMcps(
  deps: DiscoveryToolDeps,
  allowedMcpIds: string[],
): Promise<ToolCallResult> {
  const scoped = deps.listScopedMcps(allowedMcpIds);
  const mcps = await Promise.all(
    scoped.map(async (mcp) => ({
      slug: mcp.slug,
      name: mcp.name,
      purpose: await resolvePurpose(deps.registry, mcp),
    })),
  );
  return jsonResult({ mcps });
}
