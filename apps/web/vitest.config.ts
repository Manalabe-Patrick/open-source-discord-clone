import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // Tests hit real Postgres via @repo/database with unscoped deleteMany({}) calls in
    // beforeEach/afterAll — point at a dedicated test DB (never the dev DB) and run test
    // files serially so those unscoped cleanups can't race each other.
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/discord_clone_test',
    },
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
