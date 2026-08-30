import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { POST } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/friends/requests', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/friends/requests', () => {
  let requesterId: string
  let addresseeId: string

  beforeEach(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['friend-req@example.com', 'friend-addr@example.com'] } } })

    const requester = await prisma.user.create({ data: { email: 'friend-req@example.com', name: 'Requester' } })
    const addressee = await prisma.user.create({ data: { email: 'friend-addr@example.com', name: 'Addressee' } })
    requesterId = requester.id
    addresseeId = addressee.id
  })

  afterAll(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['friend-req@example.com', 'friend-addr@example.com'] } } })
  })

  it('creates a pending request', async () => {
    mockSession(requesterId)
    const response = await POST(makeRequest({ email: 'friend-addr@example.com' }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.status).toBe('PENDING')
    expect(body.addresseeId).toBe(addresseeId)
  })

  it('rejects sending a request to yourself', async () => {
    mockSession(requesterId)
    const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } })
    const response = await POST(makeRequest({ email: requesterUser!.email }))
    expect(response.status).toBe(400)
  })

  it('rejects a request to an email that does not exist', async () => {
    mockSession(requesterId)
    const response = await POST(makeRequest({ email: 'nobody@example.com' }))
    expect(response.status).toBe(400)
  })

  it('rejects a duplicate request', async () => {
    mockSession(requesterId)
    await POST(makeRequest({ email: 'friend-addr@example.com' }))
    const response = await POST(makeRequest({ email: 'friend-addr@example.com' }))
    expect(response.status).toBe(400)
  })
})
