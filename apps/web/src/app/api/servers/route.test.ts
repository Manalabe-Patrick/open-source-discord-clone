import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { POST, GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string | null) => {
  ;(auth as unknown as Mock).mockResolvedValue(
    userId ? { user: { id: userId }, expires: '' } : null
  )
}

describe('POST /api/servers', () => {
  let userId: string

  beforeEach(async () => {
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: 'server-owner@example.com' } })
    const user = await prisma.user.create({
      data: { email: 'server-owner@example.com', name: 'Owner' },
    })
    userId = user.id
  })

  afterAll(async () => {
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: 'server-owner@example.com' } })
  })

  it('returns 401 when not logged in', async () => {
    mockSession(null)
    const response = await POST(new Request('http://localhost/api/servers', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Server' }),
    }))
    expect(response.status).toBe(401)
  })

  it('returns 400 for a malformed request body', async () => {
    mockSession(userId)
    const response = await POST(new Request('http://localhost/api/servers', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(response.status).toBe(400)
  })

  it('creates a server and makes the creator OWNER', async () => {
    mockSession(userId)
    const response = await POST(new Request('http://localhost/api/servers', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Server' }),
    }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.name).toBe('My Server')

    const membership = await prisma.membership.findFirst({ where: { userId, serverId: body.id } })
    expect(membership?.role).toBe('OWNER')
  })

  it('lists servers the user belongs to via GET', async () => {
    mockSession(userId)
    await POST(new Request('http://localhost/api/servers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Listed Server' }),
    }))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    const listed = body.find((s: { name: string }) => s.name === 'Listed Server')
    expect(listed).toBeDefined()
    expect(listed.role).toBe('OWNER')
  })
})
