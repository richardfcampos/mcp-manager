# MCP Remote Gateway Client Configuration Schemas

**Research Date:** 2026-07-09  
**Scope:** Exact field names and auth mechanisms for 4 MCP clients connecting to remote HTTP/SSE servers  
**Authority:** Official documentation from each client vendor

---

## 1. Claude Code — Project-Scoped `.mcp.json`

**File Path:** `.mcp.json` (project root)  
**Remote Support:** ✅ Native HTTP/SSE/WebSocket  
**CLI Equivalent:** `claude mcp add --transport http <name> <url>`

### Exact JSON Schema

```json
{
  "mcpServers": {
    "gateway": {
      "type": "http",
      "url": "https://localhost:8787/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_TOKEN}"
      },
      "timeout": 30000
    }
  }
}
```

### Field Reference
- `type`: **"http"** (or alias `"streamable-http"`), `"sse"` (deprecated), `"ws"`
- `url`: Remote MCP endpoint (required if type present)
- `headers`: HTTP headers object; supports `${VAR}` expansion from environment
- `timeout`: Per-server timeout in milliseconds (optional)

### Authentication Header Support
✅ **Yes, native**. Pass tokens via `headers.Authorization` or custom headers. Supports env var interpolation: `"${MCP_TOKEN}"` resolves from shell environment at connection time. For dynamic auth, use `headersHelper` callback (advanced; see [headersHelper docs](https://code.claude.com/docs/en/mcp#use-dynamic-headers-for-custom-authentication)).

### CLI Command for Same Configuration
```bash
claude mcp add --transport http gateway https://localhost:8787/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

**Citation:** [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp) — "When configuring MCP servers via JSON in `.mcp.json`, the `type` field accepts `streamable-http` as an alias for `http`."

---

## 2. Cursor — Project and Global `.cursor/mcp.json`

**File Paths:**  
- Project: `.cursor/mcp.json` (workspace root)
- Global: `~/.cursor/mcp.json` (home directory)

**Remote Support:** ✅ Native HTTP/SSE  
**Config Structure:** Same as Claude Code (converging standards)

### Exact JSON Schema

```json
{
  "mcpServers": {
    "gateway": {
      "url": "https://localhost:8787/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_TOKEN}",
        "X-Custom-Header": "value"
      }
    }
  }
}
```

### Field Reference
- `url`: Remote MCP endpoint (required for remote servers)
- `headers`: HTTP headers; supports `${VAR}` expansion
- `auth` (optional): OAuth configuration with `CLIENT_ID`, `CLIENT_SECRET`, `scopes`

### Authentication Header Support
✅ **Yes, native**. Pass Bearer tokens or API keys in `headers` object. Env var expansion: `${MCP_TOKEN}` or `${env:MCP_TOKEN}`. OAuth: can use `auth` object for OAuth flows (if server supports).

**Note on env variables:** No `envFile` support for remote servers; use shell profile or system env instead.

**Citation:** [Cursor MCP Docs](https://cursor.com/docs/mcp) — "Remote servers (HTTP/SSE) do not support envFile. Use config interpolation with environment variables set in your shell profile."

---

## 3. VS Code — Workspace `.vscode/mcp.json`

**File Path:** `.vscode/mcp.json` (workspace root)  
**Remote Support:** ✅ Native HTTP (auto-fallback to SSE)  
**Global Override:** User settings via `~/.vscode/settings.json` or remote user settings

### Exact JSON Schema

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "mcp-token",
      "description": "MCP Gateway Bearer Token",
      "password": true
    }
  ],
  "servers": {
    "gateway": {
      "type": "http",
      "url": "https://localhost:8787/mcp",
      "headers": {
        "Authorization": "Bearer ${input:mcp-token}"
      }
    }
  }
}
```

### Field Reference

**Top-level:**
- `inputs`: Array of input variable definitions (for sensitive data like tokens)
- `servers`: Object mapping server names to configurations
- `sandbox` (optional): File system and network access rules for sandboxed servers

**Per-server:**
- `type`: **"http"** (required; VS Code tries HTTP Stream first, falls back to SSE automatically)
- `url`: Remote MCP endpoint
- `headers`: HTTP headers object
- No OAuth object in official schema; use `headers` for auth tokens

### Authentication Header Support
✅ **Yes, native**. Two mechanisms:

1. **Direct headers:** `"headers": { "Authorization": "Bearer TOKEN" }`
2. **Input variables:** Define `inputs` array, reference as `${input:input-id}` in headers

Input variables are prompted only once per session and can be marked `"password": true` to hide input.

**Citation:** [VS Code MCP Configuration Reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) — "The configuration file has three main sections: `servers`, `inputs`, and `sandbox`."

---

## 4. Claude Desktop — `claude_desktop_config.json` with mcp-remote Shim

**File Path:**  
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Remote Support:** ❌ **No native**. Requires `mcp-remote` shim (Node.js ≥18).

### Exact JSON Schema (With mcp-remote)

```json
{
  "mcpServers": {
    "gateway": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://localhost:8787/mcp",
        "--header",
        "Authorization:Bearer ${MCP_TOKEN}",
        "--transport",
        "http-only"
      ],
      "env": {
        "MCP_TOKEN": "your-bearer-token-here"
      }
    }
  }
}
```

### Field Reference

**Claude Desktop mcpServers entry:**
- `command`: **"npx"** (or full path to node binary)
- `args`: Array passed to npx
  - First arg: **"mcp-remote"** (npm package name)
  - Second arg: Remote MCP URL
  - Remaining: mcp-remote CLI flags

**mcp-remote CLI flags:**
- `--header "Name:Value"`: Custom HTTP header (note: **no spaces around colon** to avoid Windows escaping bugs)
- `--transport <mode>`: `http-first` (default), `http-only`, `sse-first`, `sse-only`
- `--debug`: Enable detailed logging to `~/.mcp-auth/{server_hash}_debug.log`
- `--static-oauth-client-metadata '{"scope":"..."}'`: OAuth config inline
- `--static-oauth-client-info '@/path/to/oauth_client_info.json'`: OAuth config from file
- `--ignore-tool "pattern*"`: Filter tools by wildcard

### Authentication Header Support
✅ **Yes, via mcp-remote CLI args**. Pass bearer tokens through `--header` flag:

```json
"args": [
  "mcp-remote",
  "https://localhost:8787/mcp",
  "--header",
  "Authorization:Bearer ${AUTH_TOKEN}"
],
"env": {
  "AUTH_TOKEN": "your-token"
}
```

**Workaround for Windows space bug:**  
If header values contain spaces and Claude Desktop mangled them, split the token:
```json
"args": [
  "mcp-remote",
  "https://localhost:8787/mcp",
  "--header",
  "Authorization:${AUTH_HEADER}"
],
"env": {
  "AUTH_HEADER": "Bearer your-token-with-spaces"
}
```

### mcp-remote npm Package

**Package Name:** `mcp-remote`  
**GitHub:** [geelen/mcp-remote](https://github.com/geelen/mcp-remote)  
**NPM:** [mcp-remote](https://www.npmjs.com/package/mcp-remote)

**Installation (automatic via npx):** Claude Desktop will invoke `npx mcp-remote` on first startup; no manual install needed. Requires Node.js ≥18.

**Basic usage:**
```bash
npx mcp-remote https://localhost:8787/mcp \
  --header "Authorization:Bearer YOUR_TOKEN" \
  --transport http-only
```

**OAuth support:**
```bash
npx mcp-remote https://localhost:8787/mcp \
  --static-oauth-client-metadata '{"scope":"read write"}'
```

**Citation:** [MCP GitHub Discussion #16](https://github.com/orgs/modelcontextprotocol/discussions/16) and [geelen/mcp-remote README](https://github.com/geelen/mcp-remote) confirm mcp-remote is the only supported bridge for Claude Desktop → remote MCP over HTTP.

---

## Comparison Matrix

| Aspect | Claude Code | Cursor | VS Code | Claude Desktop |
|--------|-------------|--------|---------|----------------|
| **Remote HTTP Native?** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ Via shim |
| **Config File Location** | `.mcp.json` | `.cursor/mcp.json` | `.vscode/mcp.json` | `claude_desktop_config.json` |
| **Global Config?** | `~/.claude.json` | `~/.cursor/mcp.json` | Via settings | N/A (shim only) |
| **Type Field** | `"http"` / `"sse"` / `"ws"` | N/A (implicit) | `"http"` | N/A (mcp-remote cmd) |
| **Auth Mechanism** | `headers` + env vars | `headers` / `auth` | `headers` / `inputs` | `--header` CLI flag |
| **Bearer Token Example** | `"Authorization": "Bearer ${MCP_TOKEN}"` | `"Authorization": "Bearer ${MCP_TOKEN}"` | `"Authorization": "Bearer ${input:token}"` | `--header "Authorization:Bearer ${TOKEN}"` |
| **OAuth Support** | Partial (headersHelper) | Yes (auth object) | Headers-only | Yes (mcp-remote flags) |
| **CLI Add Command?** | ✅ `claude mcp add --transport http` | ❌ No | ❌ No | ❌ No |
| **Variable Expansion** | `${VAR}` (shell env) | `${VAR}` (shell env) | `${input:id}` (prompt) or headers | `${VAR}` in env object |

---

## Recommendations for Remote Gateway Implementation

### For Streamable HTTP at `https://localhost:8787/mcp?token=<TOKEN>`

**Option A: Token in Query Param (Browser-friendly, not HTTPS standard)**

Not recommended for any client below. All four clients prefer `Authorization` headers.

**Option B: Authorization Header (Recommended)**

All four clients support this natively or via shim:

```
GET https://localhost:8787/mcp
Authorization: Bearer <TOKEN>
```

**Option C: Custom Header (Client-agnostic)**

Support both Authorization and custom headers:

```
GET https://localhost:8787/mcp
X-MCP-Token: <TOKEN>
```

Cursor, Claude Code, and VS Code all pass custom headers. Claude Desktop requires explicit `--header "X-MCP-Token:${TOKEN}"` in mcp-remote args.

### Per-Client Auth Token Provisioning

| Client | Token Storage | Recommendation |
|--------|----------------|-----------------|
| Claude Code | Shell env `$MCP_TOKEN` | Expand at runtime: `"Authorization": "Bearer ${MCP_TOKEN}"` |
| Cursor | Shell env `$MCP_TOKEN` | Same as Claude Code |
| VS Code | Prompts user once per session | Secure; use `"password": true` in inputs |
| Claude Desktop | `.env` or `env` in config | No envFile; use `"env": { "TOKEN": "..." }` in mcpServers |

---

## Unresolved Questions

1. **Does mcp-remote support mTLS / client certificate auth?** — Could not confirm. Recommend checking GitHub issues or testing with custom `--header` workaround.
2. **Can VS Code inputs prompt for multi-line secrets (e.g., PEM certificates)?** — Documentation silent. Likely not; use file-based secrets instead.
3. **Does Cursor's `auth` object auto-handle token refresh for OAuth?** — Cursor docs indicate OAuth caching; specifics on refresh mechanics unclear.

---

## Sources

- [Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp)
- [Cursor MCP Documentation](https://cursor.com/docs/mcp)
- [VS Code MCP Configuration Reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
- [Model Context Protocol — Connect Local Servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [mcp-remote GitHub Repository](https://github.com/geelen/mcp-remote)
- [MCP GitHub Discussion #16 — HTTP Transport Support](https://github.com/orgs/modelcontextprotocol/discussions/16)
