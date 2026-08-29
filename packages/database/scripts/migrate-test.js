#!/usr/bin/env node
// Applies Prisma migrations to the dedicated Vitest test database.
//
// This is a small Node script rather than an inline `VAR=val command` npm
// script because that POSIX-only syntax doesn't work under cmd.exe/PowerShell
// on Windows. The connection string here is kept in sync with the one in
// apps/web/vitest.config.ts (the single source of truth for what DB the
// test suite talks to) — if that value changes, update it here too.
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/discord_clone_test'

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema=prisma/schema.prisma'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
  },
})

process.exit(result.status ?? 1)
