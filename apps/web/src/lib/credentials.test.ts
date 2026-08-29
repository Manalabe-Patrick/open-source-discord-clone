import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import bcrypt from 'bcryptjs'
import { prisma } from '@repo/database'
import { authorizeCredentials } from './credentials'

describe('authorizeCredentials', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: 'case-test@example.com' } })
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'case-test@example.com' } })
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
})
