import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pass the config path explicitly: Vite's PostCSS pipeline resolves this
// file relative to the process cwd, so tailwindcss's own auto-discovery
// (which searches from cwd, not from this file's directory) can miss
// web/tailwind.config.js when the build is invoked from the repo root.
const currentDir = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: join(currentDir, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
