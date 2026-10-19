import { defineConfig } from 'vitest/config';

// Every test must assert something: a test that makes no assertion fails instead of passing
// silently (docs/testing.md, suite health).
const expect = { requireAssertions: true };

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts', 'scripts/test/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/.stryker-tmp/**', '**/*.integration.test.ts', '**/*.soak.test.ts', '**/fixtures/**'],
          expect,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/**/test/**/*.integration.test.ts', 'apps/**/test/**/*.integration.test.ts'],
          testTimeout: 120_000,
          expect,
        },
      },
      {
        test: {
          name: 'soak',
          include: ['apps/**/test/**/*.soak.test.ts'],
          // The soak forces collections between samples.
          execArgv: ['--expose-gc'],
          testTimeout: 600_000,
          expect,
        },
      },
    ],
  },
});
