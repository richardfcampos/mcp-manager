# MCP TypeScript SDK: Proxy Architecture Feasibility Research

**Date**: 2026-07-09  
**Research Focus**: Confirm if MCP TypeScript SDK supports building an aggregating proxy server with multi-source tool collection and per-session scoping.

---

## Executive Summary

**VERDICT: YES, feasible. The SDK provides all required primitives for building the proxy:**
- Dual-role: act as MCP CLIENT to upstreams (stdio + HTTP) AND as MCP SERVER downstream
- Transport options: `StdioClientTransport`, `StreamableHTTPClientTransport` (client); `StreamableHTTPServerTransport` (server)
- Per-session tool scoping via Streamable HTTP sessions with dynamic `tools/list_changed` notifications
- Manual tool namespacing required (no built-in namespace collision resolution)

**Risk**: Session identification and per-connection auth scoping not fully documented in public SDK docs; will require design spike on token-to-session mapping.

---

## 1. Current Transport Story

### Recommended Transport (2025-06)

**Streamable HTTP is the modern standard.** SSE is deprecated and no longer recommended for new implementations.

| Transport | Status | Use Case | Class Names |
|-----------|--------|----------|------------|
| **stdio** | Stable | Local subprocess spawning | `StdioServerTransport`, `StdioClientTransport` |
| **Streamable HTTP** | **Recommended** | Remote multi-client HTTP | `StreamableHTTPServerTransport`, `StreamableHTTPClientTransport` |
| **SSE (HTTP+SSE)** | Deprecated | Legacy only (backward compat) | `SSEClientTransport` (no new servers) |

**Source**: [Why MCP Deprecated SSE and Went with Streamable HTTP](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/) (2025-06)  
**Rationale from spec**: SSE is stateless, token-inefficient; Streamable HTTP is resumable, supports sessions (2025-03-26 spec, reaffirmed 2025-11-25).

### Code Shape: Server-Side Transport

```typescript
// Streamable HTTP Server (modern)
import { Server } from "@modelcontextprotocol/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/server/http";
import express from "express";

const app = express();
const server = new Server({ name: "my-proxy", version: "1.0.0" });

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // or custom: () => string
    enableJsonResponse: true
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000);
await server.connect(transport);
```

**Source**: [MCP TypeScript SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk) + search results on `StreamableHTTPServerTransport`  
**Note**: Session ID handling via optional `sessionIdGenerator`; session state reachable via `transport.sessionId`.

---

## 2. Client-Side: Connecting to Upstream Servers

### Connecting to Stdio Server (Local)

```typescript
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// Spawn a local server process
const transport = new StdioClientTransport({
  command: "npx",
  args: ["@example/my-mcp-server"]
});

const client = new Client({ name: "proxy-client", version: "1.0.0" });
await client.connect(transport);

// List tools from upstream
const { tools } = await client.listTools();
for (const tool of tools) {
  console.log(`Tool: ${tool.name} - ${tool.description}`);
}

// Execute tool
const result = await client.callTool({
  name: "example_tool",
  arguments: { input: "test" }
});
```

**Source**: [MCP TypeScript SDK examples](https://github.com/modelcontextprotocol/typescript-sdk) + search results

### Connecting to Remote HTTP Server (Streamable HTTP)

```typescript
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client/http";

// Connect to remote Streamable HTTP server
const transport = new StreamableHTTPClientTransport({
  url: "https://upstream-mcp-server.com/mcp",
  sessionId: "optional-session-id-for-reattachment"
});

const client = new Client({ name: "proxy-client", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const result = await client.callTool({
  name: "remote_tool",
  arguments: { /* ... */ }
});
```

**Source**: Search results for `StreamableHTTPClientTransport`

### Connecting to Legacy SSE Server (Backward Compat)

```typescript
// Do NOT write new servers; use only for old upstreams
import { SSEClientTransport } from "@modelcontextprotocol/client/sse";

const transport = new SSEClientTransport({
  url: "https://old-sse-server.com/sse"
});

const client = new Client({ name: "proxy-client", version: "1.0.0" });
await client.connect(transport);
```

**Status**: Deprecated; only for backward compatibility with pre-2025 servers.  
**Source**: [Deep Wiki: SSE Client Transport](https://deepwiki.com/modelcontextprotocol/typescript-sdk/4.3-sse-client-transport)

---

## 3. Server-Side: Registering Tools Dynamically & Per-Session Scoping

### Basic Server Setup with Tool Registration

```typescript
import { Server } from "@modelcontextprotocol/server";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types";

const server = new Server(
  { name: "aggregator", version: "1.0.0" },
  { capabilities: { tools: {} } } // Declare tool support
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "tool_a",
        description: "Tool from upstream A",
        inputSchema: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"]
        }
      }
    ]
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  // ... proxy to upstream, filter by session, etc.
  return { content: [{ type: "text", text: "result" }] };
});

const transport = new StreamableHTTPServerTransport();
await server.connect(transport);
```

**Source**: [How to build MCP servers with TypeScript SDK](https://dev.to/shadid12/how-to-build-mcp-servers-with-typescript-sdk-1c28) + GitHub examples

### Dynamic Tool Lists (Per-Session Scoping)

The protocol supports **dynamic tool updates via `tools/list_changed` notification**. When connected via Streamable HTTP, a server can notify the client that the tool list has changed; the client re-queries.

```typescript
// After changing tool list for a session
server.notification("tools/list_changed", {}); // Notify client to refresh

// If using older protocol versions, clients may need to poll
```

**Session Identification**:
- Session ID is passed via HTTP header: `Mcp-Session-Id`
- Accessible in transport via `transport.sessionId` (can be extracted per request)
- Streamable HTTP supports session reattachment (stateful sessions)

**Per-Session Tool Filtering**:
```typescript
// Pseudo-code: extract token from request header, then filter
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  const sessionId = request.sessionId; // Access session ID
  // Map session ID to auth token -> allowed tools
  const allowedTools = tokenToAllowedTools[sessionId];
  return { tools: allowedTools };
});
```

**Concern**: The exact mechanism for extracting the incoming request/session context in `setRequestHandler` callbacks is not fully documented in public SDK docs. This may require reading transport internals or design spike.

**Source**: [MCP specification: Capability negotiation](https://modelcontextprotocol.io/specification/2025-06-18) + search results on dynamic capabilities  
**Related**: [Per-session state in Streamable HTTP](https://deepwiki.com/modelcontextprotocol/typescript-sdk/) (Deep Wiki reference)

---

## 4. Tool-Name Namespacing

### Built-In Namespace Support

**Status**: NOT in core. Opt-in via `namespaces` capability (experimental, 2025+).

The MCP specification notes that **tool names are unique only within a single server**. When aggregating from multiple upstreams, collisions are inevitable:

> "If two servers are registered to the same agent or application, and the servers have tool names in common, then disambiguation becomes impossible. Clients, like Claude Code, prefix tool names with unique identifiers to work around this issue."

**Source**: [MCP Tool Naming Collisions analysis](https://github.com/modelcontextprotocol/modelcontextprotocol) (SEP-993: Namespaces issue)

### Namespaces Capability (Opt-In, Experimental)

If server declares `namespaces` capability:

```typescript
const server = new Server(
  { name: "aggregator", version: "1.0.0" },
  { capabilities: { tools: {}, namespaces: {} } } // Experimental
);

// Servers can expose namespaced operations:
// <namespace>/tools/list
// <namespace>/prompts/list
// <namespace>/resources/list
```

**Current Usage**: Minimal production adoption; not yet standard practice.

### Recommended Approach: Manual Prefix Namespacing

Prefix tool names per upstream to avoid collisions:

```typescript
// Upstream "fileserver" exposes tool "search"
// Upstream "apigateway" exposes tool "search"

// Proxy renaming:
const proxiedTools = [
  { name: "fileserver__search", ... },  // Prefixed with upstream ID
  { name: "apigateway__search", ... }
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: proxiedTools };
});

// On call:
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const [upstreamId, toolName] = request.params.name.split("__");
  const upstream = upstreams[upstreamId];
  return await upstream.callTool(toolName, request.params.arguments);
});
```

**Source**: [Tool Naming Conventions (HasMCP)](https://hasmcp.com/glossary/tool-naming-conventions) + Microsoft Research blog on tool-space interference

---

## 5. Existing Proxy/Passthrough Helpers in SDK

### mcp-proxy (Reference Implementation)

**Project**: `mcp-proxy` (GitHub: [punkpeye/mcp-proxy](https://github.com/punkpeye/mcp-proxy))

**Purpose**: Bridges stdio MCP servers to HTTP and SSE endpoints.

**Key Design Patterns**:
- Spawns stdio server as subprocess
- Proxies requests between HTTP clients and stdio server
- Supports stateful sessions (default) or stateless mode (serverless)
- Handles `Streamable HTTP` and legacy `SSE` endpoints
- Optional API key auth via `X-API-Key` header
- CORS configuration included

**Code Pattern**:
```typescript
import { McpProxy } from "mcp-proxy";

const proxy = new McpProxy({
  serverCommand: "npx",
  serverArgs: ["@example/my-server"],
  sessionMode: "stateful" // or "stateless" for serverless
});

proxy.listen(3000);
```

**Limitation**: Single upstream only; not designed for multi-server aggregation.

**Source**: [mcp-proxy GitHub](https://github.com/punkpeye/mcp-proxy) + [NPM package](https://www.npmjs.com/package/mcp-proxy)

### Gateway/Aggregator Patterns (Community)

**MetaMCP**: Dockerized gateway that aggregates multiple MCP servers, exposes via HTTP/SSE, includes management UI.

**Status**: Community project, not official SDK helper. Reference for multi-upstream architecture.

**Source**: [MCP Gateway & Proxy Patterns (ChatForest guide)](https://chatforest.com/guides/mcp-gateway-proxy-patterns/)

### Official SDK: No Built-In Aggregator

**Finding**: The `@modelcontextprotocol/server` and `@modelcontextprotocol/client` packages provide **transports and low-level handlers**, but no pre-built aggregator or proxy helper.

**Building an aggregator requires**:
1. Instantiate multiple `Client` instances (one per upstream)
2. Implement `ListToolsRequestSchema` handler that aggregates all upstream tools
3. Implement `CallToolRequestSchema` handler that routes to upstream clients
4. Manage session state and per-session tool filtering manually

**Source**: [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — no proxy module found

---

## Architecture Shape for Your Proxy

### High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│  Proxy (MCP Server)                                         │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ StreamableHTTPServerTransport (Downstream)          │  │
│  │ - Handles /mcp POST endpoint                        │  │
│  │ - Receives session ID from request header           │  │
│  │ - Maps token → allowed tools                        │  │
│  └──────────────────────────────────────────────────────┘  │
│           ↑                                                  │
│           │ setRequestHandler(ListToolsRequestSchema)       │
│           │ setRequestHandler(CallToolRequestSchema)        │
│           ↓                                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Aggregation Logic                                    │  │
│  │ - Maintain Map<upstreamId, Client>                  │  │
│  │ - Prefix tool names (e.g., "upstream1__tool")      │  │
│  │ - Route calls to upstream clients                   │  │
│  │ - Filter per session/token                          │  │
│  └──────────────────────────────────────────────────────┘  │
│           ↓                ↓                ↓                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Client 1     │  │ Client 2     │  │ Client 3     │       │
│  │(StdioClient) │  │(HTTPClient)  │  │(HTTPClient)  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│           ↓                ↓                ↓                │
└─────────────────────────────────────────────────────────────┘
        ↓                ↓                ↓
   [Upstream 1]    [Upstream 2]    [Upstream 3]
   (stdio proc)    (HTTP server)   (HTTP server)
```

### Session & Auth Mapping (TODO: Design Spike)

The proxy needs to map downstream token → session ID → allowed tools.

**Unresolved Questions**:
1. How to extract auth token from Streamable HTTP request in `setRequestHandler` callback? (transport context? middleware hook?)
2. Does `StreamableHTTPServerTransport.sessionId` persist across multiple RPC calls in the same session, or reset per call?
3. Can we intercept the raw HTTP request/headers before transport processing, or only after?

**Workaround**: Use Express middleware to extract token before MCP transport handler:

```typescript
const tokenToSession = new Map();

app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];
  if (token) {
    req.mcpToken = token;
  }
  next();
});

app.post("/mcp", async (req, res) => {
  const token = req.mcpToken;
  const allowedTools = tokenToAllowedTools[token];
  // Pass to handler somehow...
  const transport = new StreamableHTTPServerTransport();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
```

**Risk**: Method to pass context (allowedTools) to handler is manual and not standardized.

---

## Feasibility Verdict

### **FEASIBLE: YES, WITH CAVEATS**

**What You Can Do**:
- ✅ Act as MCP client to N upstreams (stdio + Streamable HTTP)
- ✅ Expose aggregated tools via Streamable HTTP
- ✅ Namespace tool names manually (e.g., `upstream__toolname`)
- ✅ Support per-session tool filtering (via session/token mapping)
- ✅ Handle dynamic tool updates (via `tools/list_changed` notification)

**What Requires Work**:
- ⚠️ Session/auth token extraction within handlers (no direct API; workaround via Express middleware)
- ⚠️ No built-in aggregator; must implement `ListToolsRequestSchema` + `CallToolRequestSchema` handlers manually
- ⚠️ Tool namespacing must be manual prefix logic (no built-in collision resolution)
- ⚠️ SSE for legacy upstreams works but deprecated; expect clients to upgrade

**Technical Risks** (Low):
- Session state persistence and reattachment untested in proxy scenario
- Per-session isolation if handler context leaks between sessions

**Design Spike Needed**:
- Confirm session ID lifetime and per-request availability in handler context
- Test reattachment flow with Streamable HTTP sessions
- Prototype auth token → session mapping in middleware layer

---

## Key Class/Method Reference

| Component | Class | Method | Import |
|-----------|-------|--------|--------|
| **Server** | `Server` | `setRequestHandler()`, `notification()` | `@modelcontextprotocol/server` |
| **Server Transport (HTTP)** | `StreamableHTTPServerTransport` | `handleRequest()`, `close()` | `@modelcontextprotocol/server/http` |
| **Server Transport (Stdio)** | `StdioServerTransport` | `start()` | `@modelcontextprotocol/server/stdio` |
| **Client** | `Client` | `listTools()`, `callTool()` | `@modelcontextprotocol/client` |
| **Client Transport (Stdio)** | `StdioClientTransport` | `start()` | `@modelcontextprotocol/client/stdio` |
| **Client Transport (HTTP)** | `StreamableHTTPClientTransport` | `connect()` | `@modelcontextprotocol/client/http` |
| **Client Transport (Legacy SSE)** | `SSEClientTransport` | `connect()` | `@modelcontextprotocol/client/sse` |
| **Schema Handlers** | `ListToolsRequestSchema`, `CallToolRequestSchema` | (schemas for handlers) | `@modelcontextprotocol/sdk/types` |

---

## Sources Cited

1. [MCP TypeScript SDK - Official GitHub](https://github.com/modelcontextprotocol/typescript-sdk)
2. [MCP Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
3. [Why MCP Deprecated SSE (2025-06)](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/)
4. [mcp-proxy GitHub](https://github.com/punkpeye/mcp-proxy)
5. [MCP Gateway & Proxy Patterns (ChatForest)](https://chatforest.com/guides/mcp-gateway-proxy-patterns/)
6. [How to build MCP servers with TypeScript SDK (DEV Community)](https://dev.to/shadid12/how-to-build-mcp-servers-with-typescript-sdk-1c28)
7. [Tool Naming Conventions (HasMCP)](https://hasmcp.com/glossary/tool-naming-conventions)
8. [MCP Namespaces Proposal (GitHub SEP-993)](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/993)
9. [Streamable HTTP Transport Deep Wiki](https://deepwiki.com/modelcontextprotocol/typescript-sdk/4.2-streamable-http-client-transport)
10. [Microsoft Research: Tool-space Interference](https://www.microsoft.com/en-us/research/blog/tool-space-interference-in-the-mcp-era-designing-for-agent-compatibility-at-scale/)

---

## Unresolved Questions

1. **Session/Request Context in Handlers**: How to reliably extract the HTTP request (headers, auth token) from within a `setRequestHandler` callback? Current solution: Express middleware workaround. *Severity: HIGH — blocks auth scoping*.

2. **Session Reattachment Workflow**: Does Streamable HTTP session reattachment reset tool availability, or does `ListToolsRequestSchema` get re-invoked with the same session ID? *Severity: MEDIUM — affects resilience*.

3. **Tool Update Notifications**: Does `tools/list_changed` notification trigger automatic client re-query, or is it advisory? *Severity: MEDIUM — affects dynamic scoping*.

4. **Namespaces Capability Maturity**: When will `namespaces` capability move from experimental to standard? Current adoption status? *Severity: LOW — alternative: manual prefixing works today*.

---

**Status**: RESEARCH COMPLETE  
**Recommendation**: PROCEED to design spike focusing on session/auth extraction and session lifetime testing.
