import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@repo/database'
import { markEmailVerifiedForGoogleUser } from './accountLinking'

describe('markEmailVerifiedForGoogleUser', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: 'link-test@example.com' } })
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'link-test@example.com' } })
  })

  it('marks an existing unverified user as emailVerified', async () => {
    const user = await prisma.user.create({ data: { email: 'link-test@example.com', name: 'Link Test' } })
    expect(user.emailVerified).toBeNull()

    await markEmailVerifiedForGoogleUser('link-test@example.com')

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.emailVerified).not.toBeNull()
  })

  it('does nothing when no user exists with that email', async () => {
    await expect(markEmailVerifiedForGoogleUser('link-test@example.com')).resolves.not.toThrow()
  })
})
