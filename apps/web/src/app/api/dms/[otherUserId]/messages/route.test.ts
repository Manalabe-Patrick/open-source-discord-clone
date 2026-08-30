import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('GET /api/dms/:otherUserId/messages', () => {
  let userAId: string
  let userBId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dmhist-a@example.com', 'dmhist-b@example.com'] } } })

    const userA = await prisma.user.create({ data: { email: 'dmhist-a@example.com', name: 'A' } })
    const userB = await prisma.user.create({ data: { email: 'dmhist-b@example.com', name: 'B' } })
    userAId = userA.id
    userBId = userB.id
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dmhist-a@example.com', 'dmhist-b@example.com'] } } })
  })

  it('returns 401 when not logged in', async () => {
    ;(auth as unknown as Mock).mockResolvedValue(null)
    const response = await GET(new Request('http://localhost/api/dms/x/messages'), { params: Promise.resolve({ otherUserId: userBId }) })
    expect(response.status).toBe(401)
  })

  it('returns an empty array when no conversation exists yet', async () => {
    mockSession(userAId)
    const response = await GET(new Request('http://localhost/api/dms/x/messages'), { params: Promise.resolve({ otherUserId: userBId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([])
  })

  it('returns messages oldest-first with author info', async () => {
    const conversation = await prisma.dmConversation.create({
      data: { participants: { create: [{ userId: userAId }, { userId: userBId }] } },
    })
    await prisma.message.create({ data: { content: 'hi', dmConversationId: conversation.id, authorId: userAId } })
    await prisma.message.create({ data: { content: 'hello', dmConversationId: conversation.id, authorId: userBId } })

    mockSession(userAId)
    const response = await GET(new Request('http://localhost/api/dms/x/messages'), { params: Promise.resolve({ otherUserId: userBId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body[0].content).toBe('hi')
    expect(body[1].content).toBe('hello')
    expect(body[1].author).toEqual({ id: userBId, name: 'B', image: null })
  })
})
