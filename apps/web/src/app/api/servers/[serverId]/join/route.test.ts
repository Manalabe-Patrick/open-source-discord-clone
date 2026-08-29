import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { POST as join } from './route'
import { POST as leave } from '../leave/route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('join/leave server', () => {
  let serverId: string
  let joinerId: string
  let ownerId: string

  beforeEach(async () => {
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['owner2@example.com', 'joiner@example.com'] } } })

    const owner = await prisma.user.create({ data: { email: 'owner2@example.com', name: 'Owner' } })
    const joiner = await prisma.user.create({ data: { email: 'joiner@example.com', name: 'Joiner' } })
    joinerId = joiner.id
    ownerId = owner.id

    const server = await prisma.server.create({
      data: { name: 'Joinable Server', ownerId: owner.id, memberships: { create: { userId: owner.id, role: 'OWNER' } } },
    })
    serverId = server.id
  })

  afterAll(async () => {
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['owner2@example.com', 'joiner@example.com'] } } })
  })

  it('lets a user join as MEMBER', async () => {
    mockSession(joinerId)
    const response = await join(new Request(`http://localhost/api/servers/${serverId}/join`, { method: 'POST' }), {
      params: Promise.resolve({ serverId }),
    })
    expect(response.status).toBe(200)

    const membership = await prisma.membership.findUnique({ where: { userId_serverId: { userId: joinerId, serverId } } })
    expect(membership?.role).toBe('MEMBER')
  })

  it('is idempotent when joining twice', async () => {
    mockSession(joinerId)
    await join(new Request(`http://localhost/api/servers/${serverId}/join`, { method: 'POST' }), { params: Promise.resolve({ serverId }) })
    const response = await join(new Request(`http://localhost/api/servers/${serverId}/join`, { method: 'POST' }), { params: Promise.resolve({ serverId }) })
    expect(response.status).toBe(200)

    const count = await prisma.membership.count({ where: { userId: joinerId, serverId } })
    expect(count).toBe(1)
  })

  it('lets a member leave', async () => {
    mockSession(joinerId)
    await join(new Request(`http://localhost/api/servers/${serverId}/join`, { method: 'POST' }), { params: Promise.resolve({ serverId }) })
    const response = await leave(new Request(`http://localhost/api/servers/${serverId}/leave`, { method: 'POST' }), { params: Promise.resolve({ serverId }) })
    expect(response.status).toBe(200)

    const membership = await prisma.membership.findUnique({ where: { userId_serverId: { userId: joinerId, serverId } } })
    expect(membership).toBeNull()
  })

  it('blocks the OWNER from leaving', async () => {
    mockSession(ownerId)
    const response = await leave(new Request(`http://localhost/api/servers/${serverId}/leave`, { method: 'POST' }), {
      params: Promise.resolve({ serverId }),
    })
    expect(response.status).toBe(403)

    const membership = await prisma.membership.findUnique({ where: { userId_serverId: { userId: ownerId, serverId } } })
    expect(membership).not.toBeNull()
    expect(membership?.role).toBe('OWNER')
  })

  it('blocks a non-member from leaving a server they are not in', async () => {
    mockSession(joinerId)
    const response = await leave(new Request(`http://localhost/api/servers/${serverId}/leave`, { method: 'POST' }), {
      params: Promise.resolve({ serverId }),
    })
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toBe('Not a member of this server')
  })
})
