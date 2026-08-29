import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { DELETE } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('DELETE /api/servers/:serverId/channels/:channelId', () => {
  let serverId: string
  let channelId: string
  let ownerId: string
  let memberId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['delchan-owner@example.com', 'delchan-member@example.com'] } } })

    const owner = await prisma.user.create({ data: { email: 'delchan-owner@example.com', name: 'Owner' } })
    ownerId = owner.id
    const member = await prisma.user.create({ data: { email: 'delchan-member@example.com', name: 'Member' } })
    memberId = member.id

    const server = await prisma.server.create({
      data: {
        name: 'Delete Channel Server',
        ownerId: owner.id,
        memberships: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: member.id, role: 'MEMBER' }] },
      },
    })
    serverId = server.id

    const channel = await prisma.channel.create({ data: { name: 'to-delete', serverId } })
    channelId = channel.id
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['delchan-owner@example.com', 'delchan-member@example.com'] } } })
  })

  it('lets an OWNER delete a channel', async () => {
    mockSession(ownerId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/channels/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, channelId }),
    })

    expect(response.status).toBe(200)
    const found = await prisma.channel.findUnique({ where: { id: channelId } })
    expect(found).toBeNull()
  })

  it('blocks a MEMBER from deleting a channel', async () => {
    mockSession(memberId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/channels/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, channelId }),
    })

    expect(response.status).toBe(403)
    const found = await prisma.channel.findUnique({ where: { id: channelId } })
    expect(found).not.toBeNull()
  })

  it('returns 404 for a channel that does not belong to the server', async () => {
    mockSession(ownerId)
    const otherServer = await prisma.server.create({
      data: { name: 'Other', ownerId, memberships: { create: { userId: ownerId, role: 'OWNER' } } },
    })

    const response = await DELETE(new Request('http://localhost/api/servers/x/channels/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId: otherServer.id, channelId }),
    })

    expect(response.status).toBe(404)
  })
})
