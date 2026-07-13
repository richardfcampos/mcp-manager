# ---- Builder: install all deps (incl. dev) and produce server + web bundles ----
FROM node:22-slim AS builder

# python3/make/g++ are needed for better-sqlite3's native build when no
# prebuilt binary matches the image's node/libc/arch combination.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.1.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY web ./web

RUN pnpm build
RUN pnpm build:web

# ---- Production dependencies only (no devDependencies, smaller layer) ----
FROM node:22-slim AS prod-deps

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.1.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

# ---- Runtime: minimal image, non-root user, npx (Node) + uvx (Python) available ----
FROM node:22-slim AS runtime

# Copy the uv/uvx binaries so stdio MCP servers distributed as Python
# packages (via uvx) run in the same container as Node-based ones (via npx).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Non-root uid 1000: gateway spawns arbitrary MCP child processes (npx/uvx),
# so the container never runs that surface as root. node:22-slim already
# ships a uid/gid 1000 user ("node"); reuse it instead of colliding with it.
# The uv/npm cache dirs are created here (not just at runtime) so the named
# volumes mounted over them inherit uid 1000 ownership on first creation --
# a root-owned fresh volume makes every uvx spawn die with EACCES.
RUN mkdir -p /app/data /workspace /home/node/.cache/uv /home/node/.npm \
    && chown -R 1000:1000 /app /workspace /home/node/.cache /home/node/.npm

COPY --from=prod-deps --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=builder --chown=1000:1000 /app/dist ./dist
COPY --from=builder --chown=1000:1000 /app/web/dist ./web/dist
COPY --chown=1000:1000 package.json ./

ENV NODE_ENV=production
ENV MCP_MANAGER_WORKSPACE_ROOT=/workspace
# A process bound to its own container-internal loopback is unreachable
# through Docker's bridge network port publishing. The actual "never leaves
# localhost" guarantee is enforced one layer out, by docker-compose
# publishing the port on the host's 127.0.0.1 only (see docker-compose.yml).
ENV HOST=0.0.0.0
VOLUME ["/app/data"]

USER 1000

EXPOSE 3000

CMD ["node", "dist/server.js"]
