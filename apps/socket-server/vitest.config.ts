import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Mirrors apps/web/vitest.config.ts: tests create/delete real rows via
    // @repo/database — point at the dedicated test DB, never the dev DB.
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/discord_clone_test',
    },
    fileParallelism: false,
  },
})
