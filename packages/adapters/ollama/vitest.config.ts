import { defineConfig } from 'vitest/config';

// Used by Stryker to run this package's tests in isolation.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
