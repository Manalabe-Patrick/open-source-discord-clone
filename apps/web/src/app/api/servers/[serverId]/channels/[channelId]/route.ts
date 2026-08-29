import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'
import { canDeleteChannel } from '@repo/permissions'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serverId: string; channelId: string }> }
) {
  const { serverId, channelId } = await params

  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  if (!canDeleteChannel(result.membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const channel = await prisma.channel.findFirst({ where: { id: channelId, serverId } })
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  await prisma.channel.delete({ where: { id: channelId } })

  return NextResponse.json({ deleted: true }, { status: 200 })
}
