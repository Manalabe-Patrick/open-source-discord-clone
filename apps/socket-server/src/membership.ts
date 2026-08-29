import { prisma, type Role } from '@repo/database'

export async function getServerMembership(
  userId: string,
  channelId: string
): Promise<{ serverId: string; role: Role } | null> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { serverId: true } })
  if (!channel) return null

  const membership = await prisma.membership.findUnique({
    where: { userId_serverId: { userId, serverId: channel.serverId } },
  })
  if (!membership) return null

  return { serverId: channel.serverId, role: membership.role }
}
