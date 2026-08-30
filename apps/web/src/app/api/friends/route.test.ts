import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('GET /api/friends', () => {
  let meId: string
  let friendId: string
  let incomingRequesterId: string
  let outgoingAddresseeId: string

  beforeEach(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['friends-me@example.com', 'friends-friend@example.com', 'friends-incoming@example.com', 'friends-outgoing@example.com'] } } })

    const me = await prisma.user.create({ data: { email: 'friends-me@example.com', name: 'Me' } })
    const friend = await prisma.user.create({ data: { email: 'friends-friend@example.com', name: 'Friend', status: 'ONLINE' } })
    const incomingRequester = await prisma.user.create({ data: { email: 'friends-incoming@example.com', name: 'Incoming' } })
    const outgoingAddressee = await prisma.user.create({ data: { email: 'friends-outgoing@example.com', name: 'Outgoing' } })
    meId = me.id
    friendId = friend.id
    incomingRequesterId = incomingRequester.id
    outgoingAddresseeId = outgoingAddressee.id

    await prisma.friendRequest.create({ data: { requesterId: meId, addresseeId: friendId, status: 'ACCEPTED' } })
    await prisma.friendRequest.create({ data: { requesterId: incomingRequesterId, addresseeId: meId, status: 'PENDING' } })
    await prisma.friendRequest.create({ data: { requesterId: meId, addresseeId: outgoingAddresseeId, status: 'PENDING' } })
  })

  afterAll(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['friends-me@example.com', 'friends-friend@example.com', 'friends-incoming@example.com', 'friends-outgoing@example.com'] } } })
  })

  it('lists friends, incoming, and outgoing requests', async () => {
    mockSession(meId)
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.friends).toEqual([{ id: friendId, name: 'Friend', image: null, status: 'ONLINE' }])
    expect(body.incoming).toHaveLength(1)
    expect(body.incoming[0].requester.id).toBe(incomingRequesterId)
    expect(body.outgoing).toHaveLength(1)
    expect(body.outgoing[0].addressee.id).toBe(outgoingAddresseeId)
  })
})
