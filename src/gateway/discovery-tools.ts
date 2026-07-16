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
      'Invoke a tool on a specific MCP server. Provide the MCP slug (from list_mcps), the tool name (from get_mcp_tools) and the tool\'s own arguments in the field named "args" -- not "arguments", not "input". The call is forwarded to the upstream MCP and its result returned verbatim.',
    inputSchema: {
      type: 'object',
      properties: {
        mcp: { type: 'string', description: 'Slug of the MCP server, exactly as returned by list_mcps.' },
        tool: { type: 'string', description: 'Tool name, exactly as returned by get_mcp_tools (no slug prefix).' },
        // Named `args`, not `arguments`: the MCP tools/call envelope is itself
        // {name, arguments}, so an `arguments` field here forced the calling AI
        // to nest `arguments` inside `arguments` -- a collision it got wrong in
        // real use, sending `input` instead (DISC-04).
        args: {
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

/** Top-level fields each meta-tool accepts. The low-level SDK Server does NOT
 * validate a tools/call payload against the declared inputSchema, so the
 * `additionalProperties: false` above is decorative -- this table is what
 * actually enforces it at runtime (DISC-08). */
const VALID_TOOL_FIELDS: Record<string, readonly string[]> = {
  list_mcps: [],
  get_mcp_tools: ['mcp'],
  call_mcp_tool: ['mcp', 'tool', 'args'],
};

/** Serializes a payload as the JSON text content MCP clients expect. */
function jsonResult(payload: unknown): ToolCallResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/** A tool-level error (isError), not a thrown/protocol error, so the calling
 * AI can read the text and recover. */
function errorResult(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/**
 * Resolves a slug to its scoped metadata using ONLY the sanitized DB read --
 * never the registry (DISC-05). A slug outside this consumer's scope, and a
 * slug that doesn't exist at all, both resolve to null: callers must map both
 * to the SAME opaque error so the response never reveals whether a MCP exists
 * for some other consumer.
 */
function resolveScopedMcp(
  deps: DiscoveryToolDeps,
  allowedMcpIds: string[],
  slug: unknown,
): ScopedMcp | null {
  if (typeof slug !== 'string' || slug.length === 0) {
    return null;
  }
  return deps.listScopedMcps(allowedMcpIds).find((mcp) => mcp.slug === slug) ?? null;
}

/** DISC-05: identical opaque result for an out-of-scope slug and a nonexistent
 * one -- embeds only the slug the caller already supplied, revealing nothing
 * about MCPs owned by other consumers. */
function notAvailableError(slug: unknown): ToolCallResult {
  const shown = typeof slug === 'string' ? slug : '';
  return errorResult(`MCP "${shown}" is not available for this consumer`);
}

/** SEC-10: the ONLY text emitted when an upstream connect/call throws. The raw
 * error (e.g. `spawn /path/to/uvx ENOENT`) can leak commands and filesystem
 * paths, so it is never included -- only the slug the caller already knows. */
function unreachableError(slug: string): ToolCallResult {
  return errorResult(`Failed to reach MCP "${slug}"`);
}

const CALL_TOOL_FIELD_ERRORS: Record<string, string> = {
  mcp: 'call_mcp_tool requires "mcp" to be a non-empty string (the MCP slug from list_mcps).',
  tool: 'call_mcp_tool requires "tool" to be a non-empty string (the tool name from get_mcp_tools).',
  args: 'call_mcp_tool requires "args" to be an object when provided.',
};

/** DISC-06: validates the call_mcp_tool payload shape, returning the name of
 * the first offending field (or null when valid) so the error can name it. */
function invalidCallToolField(args: unknown): keyof typeof CALL_TOOL_FIELD_ERRORS | null {
  const obj = isPlainObject(args) ? args : {};
  if (typeof obj.mcp !== 'string' || obj.mcp.length === 0) {
    return 'mcp';
  }
  if (typeof obj.tool !== 'string' || obj.tool.length === 0) {
    return 'tool';
  }
  if (obj.args !== undefined && !isPlainObject(obj.args)) {
    return 'args';
  }
  return null;
}

/**
 * DISC-08: rejects any top-level field outside the meta-tool's contract,
 * naming both the offending field(s) and the valid ones so the caller can
 * self-correct. A stray field must never degrade to "tool takes no arguments"
 * -- that is exactly the regression this guards: a calling AI sent `input`
 * instead of `args`, the optional field read as absent, and `undefined` went
 * upstream where it surfaced as a cryptic schema error. Returns null for an
 * unrecognized tool name so the dispatcher's own unknown-tool error owns it.
 */
function unknownFieldError(toolName: string, args: unknown): ToolCallResult | null {
  const valid = VALID_TOOL_FIELDS[toolName] as readonly string[] | undefined;
  if (!valid) {
    return null;
  }
  const unknown = Object.keys(isPlainObject(args) ? args : {}).filter((key) => !valid.includes(key));
  if (unknown.length === 0) {
    return null;
  }
  const offending = unknown.map((key) => `"${key}"`).join(', ');
  const expected = valid.length > 0 ? valid.join(', ') : '(none)';
  return errorResult(`${toolName}: unknown field ${offending}. Valid fields: ${expected}.`);
}

/**
 * get_mcp_tools (DISC-03): lists the tools of one scoped MCP with their
 * ORIGINAL names (no `<slug>__` prefix -- the {mcp, tool} pair already
 * disambiguates), plus description and inputSchema. Only those three fields
 * are projected, so no upstream-defined extra field can leak (SEC-10). A slug
 * outside scope yields the opaque error without touching the registry
 * (DISC-05); an upstream that fails to connect yields the sanitized reach
 * error and doesn't affect other MCPs (DISC-07).
 */
export async function handleGetMcpTools(
  deps: DiscoveryToolDeps,
  allowedMcpIds: string[],
  args: unknown,
): Promise<ToolCallResult> {
  const slug = isPlainObject(args) ? args.mcp : undefined;
  const scopedMcp = resolveScopedMcp(deps, allowedMcpIds, slug);
  if (!scopedMcp) {
    return notAvailableError(slug);
  }
  try {
    const entry = await deps.registry.getClient(scopedMcp.id);
    const { tools } = await entry.client.listTools();
    const mapped = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    return jsonResult({ mcp: scopedMcp.slug, tools: mapped });
  } catch {
    return unreachableError(scopedMcp.slug);
  }
}

/**
 * call_mcp_tool (DISC-04): after validating the payload (DISC-06) and
 * resolving the slug within scope (DISC-05), forwards to the upstream and
 * returns its CallToolResult VERBATIM -- including a resolved isError result
 * (e.g. the upstream reporting an unknown tool), which is the upstream's own
 * data and passes through untouched. Only a THROWN connect/call failure is
 * sanitized to the opaque reach error (SEC-10/DISC-07).
 */
export async function handleCallMcpTool(
  deps: DiscoveryToolDeps,
  allowedMcpIds: string[],
  args: unknown,
): Promise<unknown> {
  const invalidField = invalidCallToolField(args);
  if (invalidField) {
    return errorResult(CALL_TOOL_FIELD_ERRORS[invalidField]);
  }
  const { mcp: slug, tool, args: toolArgs } = args as {
    mcp: string;
    tool: string;
    args?: Record<string, unknown>;
  };
  const scopedMcp = resolveScopedMcp(deps, allowedMcpIds, slug);
  if (!scopedMcp) {
    return notAvailableError(slug);
  }
  try {
    const entry = await deps.registry.getClient(scopedMcp.id);
    // DISC-09: an omitted `args` forwards `{}`, never `undefined` -- a tool
    // with required parameters must answer "field X missing" rather than the
    // upstream's opaque "expected object" on a missing arguments envelope.
    return await entry.client.callTool({ name: tool, arguments: toolArgs ?? {} });
  } catch {
    return unreachableError(scopedMcp.slug);
  }
}

/**
 * Dispatches a tools/call to the matching discovery handler (DISC-01). An
 * unknown tool name is a tool-level error, not a thrown/protocol error, so the
 * calling AI can read the text and recover.
 *
 * The unknown-field check (DISC-08) runs here, before any handler: this is the
 * single entry point the gateway routes through, and the valid-field table is
 * keyed by tool name, so one guard covers all three meta-tools. It precedes
 * every handler, hence every registry/upstream contact.
 */
export async function handleDiscoveryToolCall(
  deps: DiscoveryToolDeps,
  allowedMcpIds: string[],
  toolName: string,
  args: unknown,
): Promise<unknown> {
  const unknownField = unknownFieldError(toolName, args);
  if (unknownField) {
    return unknownField;
  }
  switch (toolName) {
    case 'list_mcps':
      return handleListMcps(deps, allowedMcpIds);
    case 'get_mcp_tools':
      return handleGetMcpTools(deps, allowedMcpIds, args);
    case 'call_mcp_tool':
      return handleCallMcpTool(deps, allowedMcpIds, args);
    default:
      return errorResult(`Unknown tool: "${toolName}"`);
  }
}
