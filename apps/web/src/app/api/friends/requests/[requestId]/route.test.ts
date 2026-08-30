import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { PATCH } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

function makeRequest(action: string) {
  return new Request('http://localhost/api/friends/requests/x', {
    method: 'PATCH',
    body: JSON.stringify({ action }),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('PATCH /api/friends/requests/:requestId', () => {
  let requesterId: string
  let addresseeId: string
  let requestId: string

  beforeEach(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['patch-req@example.com', 'patch-addr@example.com'] } } })

    const requester = await prisma.user.create({ data: { email: 'patch-req@example.com', name: 'Requester' } })
    const addressee = await prisma.user.create({ data: { email: 'patch-addr@example.com', name: 'Addressee' } })
    requesterId = requester.id
    addresseeId = addressee.id

    const friendRequest = await prisma.friendRequest.create({ data: { requesterId, addresseeId } })
    requestId = friendRequest.id
  })

  afterAll(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['patch-req@example.com', 'patch-addr@example.com'] } } })
  })

  it('lets the addressee accept', async () => {
    mockSession(addresseeId)
    const response = await PATCH(makeRequest('accept'), { params: Promise.resolve({ requestId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('ACCEPTED')
  })

  it('lets the addressee decline', async () => {
    mockSession(addresseeId)
    const response = await PATCH(makeRequest('decline'), { params: Promise.resolve({ requestId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('DECLINED')
  })

  it('blocks the requester from acting on their own request', async () => {
    mockSession(requesterId)
    const response = await PATCH(makeRequest('accept'), { params: Promise.resolve({ requestId }) })
    expect(response.status).toBe(403)
  })

  it('returns 404 for a nonexistent request', async () => {
    mockSession(addresseeId)
    const response = await PATCH(makeRequest('accept'), { params: Promise.resolve({ requestId: 'nonexistent' }) })
    expect(response.status).toBe(404)
  })

  it('returns 400 for an already-resolved request', async () => {
    mockSession(addresseeId)
    await PATCH(makeRequest('accept'), { params: Promise.resolve({ requestId }) })
    const response = await PATCH(makeRequest('accept'), { params: Promise.resolve({ requestId }) })
    expect(response.status).toBe(400)
  })
})
