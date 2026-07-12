import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          passWithNoTests: true,
          fileParallelism: false,
          // Integration tests spawn real MCP child processes (node + TS
          // type-stripping + SDK import) from an external volume; under
          // background load the default 5s ceiling flakes. Passing runs
          // finish in ~1-2s — this only widens headroom, assertions are
          // unchanged.
          testTimeout: 30000,
        },
      },
    ],
  },
});
