import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    // Integration tests share a single in-memory sqlite Repository and rely on
    // clear()-between-tests ordering, so concurrent test execution is disabled.
    maxConcurrency: 1,
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  },
});
