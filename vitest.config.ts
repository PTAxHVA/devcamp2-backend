import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests live OUTSIDE src/ so the production `tsc` build never emits them to dist/.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
