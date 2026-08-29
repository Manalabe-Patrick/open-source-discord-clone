import { describe, it, expect } from 'vitest'
import { prisma } from '@repo/database'

describe('database package', () => {
  it('exposes a Prisma client instance', () => {
    expect(prisma).toBeDefined()
    expect(typeof prisma.$connect).toBe('function')
    expect(typeof prisma.user.findUnique).toBe('function')
  })
})
