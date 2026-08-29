import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { canCreateChannel } from '@repo/permissions'
import { requireMembership } from '@/lib/requireMembership'

export async function POST(request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params
  const result = await requireMembership(serverId)
  if ('error' in result) return result.error
  const { membership } = result
  if (!canCreateChannel(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let name: string | undefined
  try {
    ;({ name } = (await request.json()) as { name?: string })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const trimmed = name?.trim()
  if (!trimmed) {
    return NextResponse.json({ error: 'Channel name is required' }, { status: 400 })
  }

  const channel = await prisma.channel.create({
    data: { name: trimmed, serverId },
  })

  return NextResponse.json(channel, { status: 201 })
}

export async function GET(_request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params
  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  const channels = await prisma.channel.findMany({ where: { serverId } })
  return NextResponse.json(channels, { status: 200 })
}
