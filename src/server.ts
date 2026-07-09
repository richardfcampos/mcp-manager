import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { loadConfig } from './config/env.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
// dist/server.js -> ../web/dist (Vite build output served as the static SPA)
const webDistDir = join(currentDir, '..', 'web', 'dist');
const webIndexHtml = join(webDistDir, 'index.html');

/**
 * Builds the Express app: health check, static SPA, and placeholder mount
 * points for the API and gateway routers added in later phases.
 *
 * NOTE: this bootstrap is intentionally monolithic for now. Phase 6 (T56)
 * consolidates app assembly into a dedicated create-app factory that mounts
 * the real api-routes and gateway-router modules; this function is the
 * placeholder that factory replaces.
 */
export function createServer(): Express {
  const app = express();

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // --- Mount point: REST API routers (src/api/*-routes.ts) go here. ---
  // Added by Phase 6 (T36 app-factory + routes) — not present yet.

  // --- Mount point: MCP gateway router (POST /mcp/:token) goes here. ---
  // Added by Phase 4/6 (T29 gateway-router, wired in T56) — not present yet.

  if (existsSync(webDistDir)) {
    app.use(express.static(webDistDir));

    // SPA fallback: any route not matched above (and not an existing static
    // asset) resolves to index.html so client-side routing works.
    app.get('*', (_req, res, next) => {
      if (!existsSync(webIndexHtml)) {
        next();
        return;
      }
      res.sendFile(webIndexHtml);
    });
  }

  return app;
}

function isMainModule(): boolean {
  const invokedPath = process.argv[1] ? fileURLToPath(new URL(`file://${process.argv[1]}`)) : '';
  return fileURLToPath(import.meta.url) === invokedPath;
}

function main(): void {
  const config = loadConfig(process.env);
  const app = createServer();

  app.listen(config.port, config.host, () => {
    console.log(`mcp-manager listening on http://${config.host}:${config.port}`);
  });
}

if (isMainModule()) {
  main();
}
