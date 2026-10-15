import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/**/test/**/*.integration.test.ts', 'apps/**/test/**/*.integration.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
