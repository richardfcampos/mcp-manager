# mcp-manager

A Dockerized, always-on MCP gateway with a web UI. Register your MCP servers
(stdio or remote) once, assign them to projects or desktop clients, and each
consumer gets a single stable gateway URL (`/mcp/:token`) that aggregates and
proxies only the tools it's allowed to use.

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
