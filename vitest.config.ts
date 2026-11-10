import { defineConfig } from 'vitest/config'

// Unit tests run in plain Node. This file deliberately leaves out the
// Cloudflare and TanStack Start plugins from vite.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
