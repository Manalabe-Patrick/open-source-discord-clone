import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@repo/database'
import { getServerMembership } from './membership'

describe('getServerMembership', () => {
  let serverId: string
  let channelId: string
  let memberUserId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: 'socket-member@example.com' } })

    const user = await prisma.user.create({ data: { email: 'socket-member@example.com', name: 'Socket Member' } })
    memberUserId = user.id

    const server = await prisma.server.create({
      data: { name: 'Socket Test Server', ownerId: user.id, memberships: { create: { userId: user.id, role: 'OWNER' } } },
    })
    serverId = server.id

    const channel = await prisma.channel.create({ data: { name: 'general', serverId } })
    channelId = channel.id
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: 'socket-member@example.com' } })
  })

  it('returns the serverId and role for a member of the channel\'s server', async () => {
    const result = await getServerMembership(memberUserId, channelId)
    expect(result).toEqual({ serverId, role: 'OWNER' })
  })

  it('returns null for a user who is not a member', async () => {
    const outsider = await prisma.user.create({ data: { email: 'socket-outsider@example.com', name: 'Outsider' } })
    const result = await getServerMembership(outsider.id, channelId)
    await prisma.user.delete({ where: { id: outsider.id } })
    expect(result).toBeNull()
  })

  it('returns null for a channel that does not exist', async () => {
    const result = await getServerMembership(memberUserId, 'nonexistent-channel-id')
    expect(result).toBeNull()
  })
})
