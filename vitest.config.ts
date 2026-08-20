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
    // better-sqlite3's native addon isn't safe to tear down inside a worker_thread;
    // on Node 24 this crashes the worker on exit (RemoveEnvironmentCleanupHook
    // assertion). Forks give each test file its own process instead.
    pool: 'forks',
  },
});
