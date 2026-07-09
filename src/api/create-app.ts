import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { errorMiddleware } from './error-middleware.js';
import { createApiRouter, type AppDeps } from './router.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
// Compiled to dist/api/create-app.js -> ../../web/dist (Vite build output).
const DEFAULT_WEB_DIST_DIR = join(currentDir, '..', '..', 'web', 'dist');

export interface CreateAppOptions extends AppDeps {
  /** Overrides the static SPA directory; used by tests that don't build
   * web/dist and by any future non-default deployment layout. Defaults to
   * the real Vite build output next to the compiled server. */
  webDistDir?: string;
}

/**
 * The single canonical Express app-assembly path (T36): mounts the `/api`
 * router, serves the built web SPA (with an index.html fallback for
 * client-side routing) when it exists, and mounts the error-handling
 * middleware LAST so every thrown/forwarded error in any router is caught.
 *
 * Resource lifecycle (opening the DB, running migrations, constructing the
 * upstream registry) is the CALLER's responsibility -- both the integration
 * test harness and the production server construct those once and pass them
 * in via `AppDeps`, so this factory stays a pure assembly step with no I/O
 * side effects of its own beyond mounting routes.
 */
export function createApp(options: CreateAppOptions): Express {
  const { webDistDir, ...deps } = options;
  const app = express();

  app.use(express.json());
  app.use('/api', createApiRouter(deps));

  const staticDir = webDistDir ?? DEFAULT_WEB_DIST_DIR;
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));

    // SPA fallback: any GET not matched above (and not an existing static
    // asset) resolves to index.html so client-side routing works.
    app.get('*', (_req, res, next) => {
      const indexHtml = join(staticDir, 'index.html');
      if (!existsSync(indexHtml)) {
        next();
        return;
      }
      res.sendFile(indexHtml);
    });
  }

  app.use(errorMiddleware);

  return app;
}

export type { AppDeps } from './router.js';
