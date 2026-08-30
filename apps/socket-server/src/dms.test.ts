import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@repo/database'
import { dmRoom, findDMConversation, getOrCreateDMConversation } from './dms'

describe('dmRoom', () => {
  it('produces the same room name regardless of argument order', () => {
    expect(dmRoom('user-a', 'user-b')).toBe(dmRoom('user-b', 'user-a'))
  })

  it('produces a stable, prefixed name', () => {
    expect(dmRoom('user-a', 'user-b')).toBe('dm:user-a:user-b')
  })
})

describe('findDMConversation / getOrCreateDMConversation', () => {
  let userAId: string
  let userBId: string
  let userCId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dm-a@example.com', 'dm-b@example.com', 'dm-c@example.com'] } } })

    const userA = await prisma.user.create({ data: { email: 'dm-a@example.com', name: 'A' } })
    const userB = await prisma.user.create({ data: { email: 'dm-b@example.com', name: 'B' } })
    const userC = await prisma.user.create({ data: { email: 'dm-c@example.com', name: 'C' } })
    userAId = userA.id
    userBId = userB.id
    userCId = userC.id
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dm-a@example.com', 'dm-b@example.com', 'dm-c@example.com'] } } })
  })

  it('findDMConversation returns null when no conversation exists', async () => {
    const result = await findDMConversation(userAId, userBId)
    expect(result).toBeNull()
  })

  it('getOrCreateDMConversation creates a conversation with both participants', async () => {
    const conversation = await getOrCreateDMConversation(userAId, userBId)
    const participants = await prisma.dmParticipant.findMany({ where: { dmConversationId: conversation.id } })

    expect(participants).toHaveLength(2)
    expect(participants.map((p) => p.userId).sort()).toEqual([userAId, userBId].sort())
  })

  it('getOrCreateDMConversation is idempotent (does not create a second conversation)', async () => {
    const first = await getOrCreateDMConversation(userAId, userBId)
    const second = await getOrCreateDMConversation(userAId, userBId)

    expect(second.id).toBe(first.id)
    const count = await prisma.dmConversation.count()
    expect(count).toBe(1)
  })

  it('getOrCreateDMConversation works with arguments in either order', async () => {
    const first = await getOrCreateDMConversation(userAId, userBId)
    const second = await getOrCreateDMConversation(userBId, userAId)

    expect(second.id).toBe(first.id)
  })

  it('findDMConversation finds an existing conversation after it is created', async () => {
    const created = await getOrCreateDMConversation(userAId, userBId)
    const found = await findDMConversation(userAId, userBId)

    expect(found?.id).toBe(created.id)
  })

  it('does not confuse a conversation between A and B with one between A and C', async () => {
    await getOrCreateDMConversation(userAId, userBId)
    const result = await findDMConversation(userAId, userCId)

    expect(result).toBeNull()
  })
})
