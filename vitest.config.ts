import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests live OUTSIDE src/ so the production `tsc` build never emits them to dist/.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Dummy-but-valid env so importing the app (which validates env on load and
    // would otherwise process.exit) succeeds. Integration tests connect to an
    // in-memory Mongo replica set, not this URI.
    env: {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://127.0.0.1:27017/vora-test',
      JWT_SECRET: 'test-jwt-secret-min-32-chars-1234567890',
      JWT_EXPIRES_IN: '7d',
      FIREWORKS_API_KEY: 'test-fireworks-key',
      RESEND_API_KEY: 'test-resend-key',
      RESEND_FROM_EMAIL: 'noreply@vora.test',
      CLIENT_URL: 'http://localhost:5173',
    },
    // Integration suites spin an in-memory Mongo replica set (first run downloads
    // the binary) — give hooks room, and run files sequentially so each suite owns
    // its own DB connection without cross-file contention.
    hookTimeout: 120000,
    testTimeout: 30000,
    fileParallelism: false,
  },
})
