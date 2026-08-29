import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('GET /api/servers/:serverId/channels/:channelId/messages', () => {
  let serverId: string
  let channelId: string
  let memberId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['msg-owner@example.com', 'msg-outsider@example.com'] } } })

    const owner = await prisma.user.create({ data: { email: 'msg-owner@example.com', name: 'Owner' } })
    memberId = owner.id

    const server = await prisma.server.create({
      data: { name: 'Message History Server', ownerId: owner.id, memberships: { create: { userId: owner.id, role: 'OWNER' } } },
    })
    serverId = server.id

    const channel = await prisma.channel.create({ data: { name: 'general', serverId } })
    channelId = channel.id

    await prisma.message.create({ data: { content: 'first message', channelId, authorId: owner.id } })
    await prisma.message.create({ data: { content: 'second message', channelId, authorId: owner.id } })
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['msg-owner@example.com', 'msg-outsider@example.com'] } } })
  })

  it('returns messages oldest-first with author info', async () => {
    mockSession(memberId)
    const response = await GET(new Request('http://localhost/api/servers/x/channels/y/messages'), {
      params: Promise.resolve({ serverId, channelId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body[0].content).toBe('first message')
    expect(body[1].content).toBe('second message')
    expect(body[0].author).toEqual({ id: memberId, name: 'Owner', image: null })
  })

  it('returns 403 for a non-member', async () => {
    const outsider = await prisma.user.create({ data: { email: 'msg-outsider@example.com', name: 'Outsider' } })
    mockSession(outsider.id)

    const response = await GET(new Request('http://localhost/api/servers/x/channels/y/messages'), {
      params: Promise.resolve({ serverId, channelId }),
    })

    expect(response.status).toBe(403)
  })

  it('returns 404 when the channel does not belong to the server', async () => {
    mockSession(memberId)
    const otherServer = await prisma.server.create({
      data: { name: 'Other Server', ownerId: memberId, memberships: { create: { userId: memberId, role: 'OWNER' } } },
    })

    const response = await GET(new Request('http://localhost/api/servers/x/channels/y/messages'), {
      params: Promise.resolve({ serverId: otherServer.id, channelId }),
    })

    expect(response.status).toBe(404)
  })
})
