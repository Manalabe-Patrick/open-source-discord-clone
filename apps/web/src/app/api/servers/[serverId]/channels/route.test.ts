import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { POST, GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('channels API', () => {
  let serverId: string
  let ownerId: string
  let memberId: string
  let outsiderId: string

  beforeEach(async () => {
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['chan-owner@example.com', 'chan-member@example.com', 'chan-outsider@example.com'] } } })

    const owner = await prisma.user.create({ data: { email: 'chan-owner@example.com', name: 'Owner' } })
    const member = await prisma.user.create({ data: { email: 'chan-member@example.com', name: 'Member' } })
    const outsider = await prisma.user.create({ data: { email: 'chan-outsider@example.com', name: 'Outsider' } })
    ownerId = owner.id
    memberId = member.id
    outsiderId = outsider.id

    const server = await prisma.server.create({
      data: {
        name: 'Channel Test Server',
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
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['chan-owner@example.com', 'chan-member@example.com', 'chan-outsider@example.com'] } } })
  })

  it('returns 400 for a malformed request body', async () => {
    mockSession(ownerId)
    const response = await POST(
      new Request(`http://localhost/api/servers/${serverId}/channels`, {
        method: 'POST',
        body: 'not json',
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ serverId }) }
    )
    expect(response.status).toBe(400)
  })

  it('rejects a whitespace-only channel name', async () => {
    mockSession(ownerId)
    const response = await POST(
      new Request(`http://localhost/api/servers/${serverId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: '   ' }),
      }),
      { params: Promise.resolve({ serverId }) }
    )
    expect(response.status).toBe(400)
  })

  it('lets an OWNER create a channel', async () => {
    mockSession(ownerId)
    const response = await POST(
      new Request(`http://localhost/api/servers/${serverId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: 'general' }),
      }),
      { params: Promise.resolve({ serverId }) }
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.name).toBe('general')
  })

  it('blocks a MEMBER from creating a channel', async () => {
    mockSession(memberId)
    const response = await POST(
      new Request(`http://localhost/api/servers/${serverId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: 'blocked' }),
      }),
      { params: Promise.resolve({ serverId }) }
    )
    expect(response.status).toBe(403)
  })

  it('lists channels for the server via GET', async () => {
    mockSession(ownerId)
    await POST(
      new Request(`http://localhost/api/servers/${serverId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: 'announcements' }),
      }),
      { params: Promise.resolve({ serverId }) }
    )

    const response = await GET(new Request('http://localhost/api/servers/x/channels'), { params: Promise.resolve({ serverId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.some((c: { name: string }) => c.name === 'announcements')).toBe(true)
  })

  it('blocks a non-member from listing channels via GET', async () => {
    mockSession(outsiderId)
    const response = await GET(new Request(`http://localhost/api/servers/${serverId}/channels`), {
      params: Promise.resolve({ serverId }),
    })
    expect(response.status).toBe(403)
  })
})
