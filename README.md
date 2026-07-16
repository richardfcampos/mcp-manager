# mcp-manager

A Dockerized, always-on MCP gateway with a web UI. Register your MCP servers
(stdio or remote) once, assign them to projects or desktop clients, and each
consumer gets a single stable gateway URL (`/mcp/:token`). Instead of dumping
every allowed tool into the client's context, the gateway exposes a small
fixed set of discovery tools and reveals MCPs and their tools on demand — see
[Gateway protocol](#gateway-protocol) below.

## Quickstart

1. **Generate a master key** (used to encrypt MCP secrets at rest):

   ```sh
   openssl rand -base64 32
   ```

2. **Configure your environment.** Copy the example file and fill it in:

   ```sh
   cp .env.example .env
   ```

   Edit `.env`:
   - `MCP_MANAGER_MASTER_KEY` — the key generated in step 1.
   - `MCP_MANAGER_WORKSPACE_ROOT` — absolute path to the folder containing
     your projects (mounted read-write for auto-discovery).
   - `PORT` — defaults to `3000`.

3. **Start the gateway:**

   ```sh
   docker compose up --build
   ```

   > Use `--build` whenever the source has changed. The compose service pins a
   > fixed image tag (`mcp-manager`), so a plain `docker compose up` reuses the
   > cached image and will not pick up code changes.

4. **Open the UI:** [http://127.0.0.1:3000](http://127.0.0.1:3000)

   The service is published to `127.0.0.1` only — it is never reachable from
   outside the host machine.

## Gateway protocol

Each consumer connects to `POST /mcp/:token` with a standard MCP client.
Instead of flattening every assigned MCP's tools into one `tools/list` (which
used to expose each tool as a prefixed `<slug>__<tool>` name and could flood
the client's context), the gateway exposes exactly 3 fixed meta-tools that let
the calling AI discover what it needs, when it needs it:

| Tool | Purpose |
| ---- | ------- |
| `list_mcps` | Lists the MCPs this consumer can use, each with a `purpose` describing what it's for. |
| `get_mcp_tools` | Lists the tools of one MCP (by slug from `list_mcps`), with original tool names and input schemas. |
| `call_mcp_tool` | Invokes one tool on one MCP and returns the upstream result verbatim. |

### Discovery flow

1. **`list_mcps`** — no arguments. Returns every MCP assigned to this consumer:

   ```json
   { "mcps": [{ "slug": "github", "name": "GitHub", "purpose": "Search and manage GitHub issues/PRs" }] }
   ```

2. **`get_mcp_tools`** — `{ "mcp": "github" }`. Returns that MCP's tools with their original, unprefixed names:

   ```json
   { "mcp": "github", "tools": [{ "name": "search_issues", "description": "...", "inputSchema": { "type": "object" } }] }
   ```

3. **`call_mcp_tool`** — `{ "mcp": "github", "tool": "search_issues", "arguments": { "query": "is:open" } }`. The call is forwarded to the upstream MCP and its result (including tool-level errors) is returned as-is.

A slug outside the consumer's assigned MCPs returns the same opaque error
whether that MCP exists for another consumer or doesn't exist at all — no MCP
inventory leaks across consumers.

### The `purpose` field

Each registered MCP has an optional `purpose` field, editable in the UI, that
`list_mcps` reads to tell the calling AI what the MCP is for. When left blank,
the gateway falls back to whatever the upstream MCP announces in its own
instructions, truncated to 400 characters so a verbose upstream can't flood
the client's context; if the upstream is unreachable or announces nothing,
`purpose` is `null` and the MCP is still listed.

### Cut-over note

The endpoint, URL format and tokens are unchanged (`POST /mcp/:token`) —
existing project/desktop configs keep working without edits. The only visible
change to an already-connected client is `tools/list`: it now always returns
the 3 meta-tools above instead of one flattened `<slug>__<tool>` entry per
assigned tool.

## Development

Requires Node >=22 and pnpm.

```sh
pnpm install
pnpm build          # compile server TypeScript
pnpm build:web       # build the React/Vite SPA
pnpm test            # run the full test suite
pnpm test:unit        # unit tests only (src/**/*.test.ts)
pnpm test:integration # integration tests only (test/integration/**/*.test.ts)
pnpm lint             # ESLint
```

## Status

Under active development — see `.specs/features/mcp-gateway-manager/` for the
full spec, design, and task plan.
