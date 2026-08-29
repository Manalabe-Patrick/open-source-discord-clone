import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string; channelId: string }> }
) {
  const { serverId, channelId } = await params

  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  const channel = await prisma.channel.findFirst({ where: { id: channelId, serverId } })
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  const messages = await prisma.message.findMany({
    where: { channelId },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, name: true, image: true } } },
  })

  const payload = messages.map((message) => ({
    id: message.id,
    content: message.content,
    channelId: message.channelId,
    createdAt: message.createdAt.toISOString(),
    author: message.author,
  }))

  return NextResponse.json(payload, { status: 200 })
}
