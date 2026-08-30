import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('GET /api/dms', () => {
  let userAId: string
  let userBId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dmlist-a@example.com', 'dmlist-b@example.com'] } } })

    const userA = await prisma.user.create({ data: { email: 'dmlist-a@example.com', name: 'A' } })
    const userB = await prisma.user.create({ data: { email: 'dmlist-b@example.com', name: 'B', status: 'ONLINE' } })
    userAId = userA.id
    userBId = userB.id
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dmlist-a@example.com', 'dmlist-b@example.com'] } } })
  })

  it('returns 401 when not logged in', async () => {
    ;(auth as unknown as Mock).mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
  })

  it('returns an empty array when the user has no conversations', async () => {
    mockSession(userAId)
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([])
  })

  it('lists a conversation with the other participant\'s info', async () => {
    const conversation = await prisma.dmConversation.create({
      data: {
        pairKey: [userAId, userBId].sort().join(':'),
        participants: { create: [{ userId: userAId }, { userId: userBId }] },
      },
    })
    mockSession(userAId)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([{ id: conversation.id, otherUser: { id: userBId, name: 'B', image: null, status: 'ONLINE' } }])
  })
})
