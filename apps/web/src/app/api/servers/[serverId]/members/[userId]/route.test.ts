import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { DELETE } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('DELETE /api/servers/:serverId/members/:userId', () => {
  let serverId: string
  let ownerId: string
  let adminId: string
  let memberId: string

  beforeEach(async () => {
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['kick-owner@example.com', 'kick-admin@example.com', 'kick-member@example.com'] } } })

    const owner = await prisma.user.create({ data: { email: 'kick-owner@example.com', name: 'Owner' } })
    ownerId = owner.id
    const admin = await prisma.user.create({ data: { email: 'kick-admin@example.com', name: 'Admin' } })
    adminId = admin.id
    const member = await prisma.user.create({ data: { email: 'kick-member@example.com', name: 'Member' } })
    memberId = member.id

    const server = await prisma.server.create({
      data: {
        name: 'Kick Test Server',
        ownerId: owner.id,
        memberships: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: admin.id, role: 'ADMIN' },
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
    await prisma.user.deleteMany({ where: { email: { in: ['kick-owner@example.com', 'kick-admin@example.com', 'kick-member@example.com'] } } })
  })

  it('lets an ADMIN kick a MEMBER', async () => {
    mockSession(adminId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/members/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, userId: memberId }),
    })

    expect(response.status).toBe(200)
    const membership = await prisma.membership.findUnique({ where: { userId_serverId: { userId: memberId, serverId } } })
    expect(membership).toBeNull()
  })

  it('blocks a MEMBER from kicking anyone', async () => {
    mockSession(memberId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/members/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, userId: adminId }),
    })

    expect(response.status).toBe(403)
  })

  it('blocks kicking the OWNER, even by another ADMIN', async () => {
    mockSession(adminId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/members/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, userId: ownerId }),
    })

    expect(response.status).toBe(403)
    const membership = await prisma.membership.findUnique({ where: { userId_serverId: { userId: ownerId, serverId } } })
    expect(membership?.role).toBe('OWNER')
  })

  it('returns 404 when the target is not a member', async () => {
    mockSession(ownerId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/members/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, userId: 'nonexistent-user-id' }),
    })

    expect(response.status).toBe(404)
  })
})
