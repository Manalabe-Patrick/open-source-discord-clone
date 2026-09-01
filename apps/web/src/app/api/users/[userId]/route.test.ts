import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('GET /api/users/[userId]', () => {
  let viewerId: string
  let targetId: string

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: { in: ['profile-viewer@example.com', 'profile-target@example.com'] } } })

    const viewer = await prisma.user.create({ data: { email: 'profile-viewer@example.com', name: 'Viewer' } })
    const target = await prisma.user.create({
      data: { email: 'profile-target@example.com', name: 'Target', bio: 'Hello there', customStatus: 'Busy', status: 'ONLINE' },
    })
    viewerId = viewer.id
    targetId = target.id
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: ['profile-viewer@example.com', 'profile-target@example.com'] } } })
  })

  it('returns 401 when not logged in', async () => {
    ;(auth as unknown as Mock).mockResolvedValue(null)
    const response = await GET(new Request('http://localhost/api/users/x'), { params: Promise.resolve({ userId: targetId }) })
    expect(response.status).toBe(401)
  })

  it('returns the public profile fields for another user', async () => {
    mockSession(viewerId)
    const response = await GET(new Request('http://localhost/api/users/x'), { params: Promise.resolve({ userId: targetId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ id: targetId, name: 'Target', image: null, status: 'ONLINE', customStatus: 'Busy', bio: 'Hello there' })
    expect(body.email).toBeUndefined()
    expect(body.passwordHash).toBeUndefined()
  })

  it('returns 404 for an unknown user', async () => {
    mockSession(viewerId)
    const response = await GET(new Request('http://localhost/api/users/x'), { params: Promise.resolve({ userId: 'does-not-exist' }) })
    expect(response.status).toBe(404)
  })
})
