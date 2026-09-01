import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import bcrypt from 'bcryptjs'
import { prisma } from '@repo/database'
import { authorizeCredentials, resetLoginRateLimit } from './credentials'

describe('authorizeCredentials', () => {
  beforeEach(async () => {
    resetLoginRateLimit()
    await prisma.user.deleteMany({ where: { email: { in: ['case-test@example.com', 'ratelimit-login@example.com'] } } })
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: ['case-test@example.com', 'ratelimit-login@example.com'] } } })
  })

  it('logs in with a different case than the stored (lowercase) email', async () => {
    const passwordHash = await bcrypt.hash('password123', 10)
    await prisma.user.create({
      data: { email: 'case-test@example.com', name: 'Case Test', passwordHash },
    })

    const result = await authorizeCredentials({ email: 'Case-Test@Example.com', password: 'password123' })

    expect(result).not.toBeNull()
    expect(result?.email).toBe('case-test@example.com')
  })

  it('returns null for an unknown email', async () => {
    const result = await authorizeCredentials({ email: 'nope@example.com', password: 'password123' })
    expect(result).toBeNull()
  })

  it('rate limits repeated login attempts for the same email', async () => {
    const passwordHash = await bcrypt.hash('password123', 10)
    await prisma.user.create({
      data: { email: 'ratelimit-login@example.com', name: 'Rate Limit Test', passwordHash },
    })

    for (let i = 0; i < 10; i++) {
      await authorizeCredentials({ email: 'ratelimit-login@example.com', password: 'wrong-password' })
    }

    const result = await authorizeCredentials({ email: 'ratelimit-login@example.com', password: 'password123' })
    expect(result).toBeNull()
  })
})
