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
    extend: {
      // Semantic tokens backed by CSS variables (see src/index.css) so the
      // whole console shares one palette: graphite-green dark base with a
      // single phosphor accent. `<alpha-value>` keeps /NN opacity utilities.
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raise: 'rgb(var(--raise) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        dim: 'rgb(var(--dim) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        err: 'rgb(var(--err) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Tight industrial radii: containers slightly softer than controls.
      borderRadius: {
        sm: '3px',
        md: '6px',
        lg: '10px',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
