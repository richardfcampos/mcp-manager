import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Resolve content globs relative to this file's own directory (web/), not
// the process cwd, so the build works whether invoked from the repo root
// (pnpm build:web) or from within web/ directly.
const currentDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [join(currentDir, 'index.html'), join(currentDir, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {},
  },
  plugins: [],
};
