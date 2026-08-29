import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('GET /api/servers/:serverId/members', () => {
  let serverId: string
  let ownerId: string

  beforeEach(async () => {
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['members-owner@example.com', 'members-member@example.com', 'members-outsider@example.com'] } } })

    const owner = await prisma.user.create({ data: { email: 'members-owner@example.com', name: 'Owner', status: 'ONLINE' } })
    ownerId = owner.id
    const member = await prisma.user.create({ data: { email: 'members-member@example.com', name: 'Member', status: 'OFFLINE' } })

    const server = await prisma.server.create({
      data: {
        name: 'Members Test Server',
        ownerId: owner.id,
        memberships: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: member.id, role: 'MEMBER' },
          ],
        },
      },
    })
    serverId = server.id
  })

  afterAll(async () => {
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['members-owner@example.com', 'members-member@example.com', 'members-outsider@example.com'] } } })
  })

  it('lists all members with role and status', async () => {
    mockSession(ownerId)
    const response = await GET(new Request('http://localhost/api/servers/x/members'), {
      params: Promise.resolve({ serverId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(2)
    const owner = body.find((m: { name: string }) => m.name === 'Owner')
    expect(owner.role).toBe('OWNER')
    expect(owner.status).toBe('ONLINE')
  })

  it('returns 403 for a non-member', async () => {
    const outsider = await prisma.user.create({ data: { email: 'members-outsider@example.com', name: 'Outsider' } })
    mockSession(outsider.id)

    const response = await GET(new Request('http://localhost/api/servers/x/members'), {
      params: Promise.resolve({ serverId }),
    })

    expect(response.status).toBe(403)
  })
})
