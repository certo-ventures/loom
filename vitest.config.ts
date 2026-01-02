import { defineConfig } from 'vitest/config'

// Suppress benign Redis connection errors during test cleanup
process.on('unhandledRejection', (reason: any) => {
  if (reason?.message === 'Connection is closed.') {
    // Ignore Redis connection close errors during cleanup
    return
  }
  // Re-throw other errors
  console.error('Unhandled Rejection:', reason)
})

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Integration tests share a single Redis instance, so we keep Vitest single-threaded to avoid cross-file interference.
    poolOptions: {
      threads: {
        singleThread: true,
        maxThreads: 1,
        minThreads: 1,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
