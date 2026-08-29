import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'
import { canKickMember } from '@repo/permissions'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serverId: string; userId: string }> }
) {
  const { serverId, userId: targetUserId } = await params

  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  if (!canKickMember(result.membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const targetMembership = await prisma.membership.findUnique({
    where: { userId_serverId: { userId: targetUserId, serverId } },
  })
  if (!targetMembership) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  if (targetMembership.role === 'OWNER') {
    return NextResponse.json({ error: 'The server owner cannot be kicked' }, { status: 403 })
  }

  await prisma.membership.delete({ where: { userId_serverId: { userId: targetUserId, serverId } } })

  return NextResponse.json({ kicked: true }, { status: 200 })
}
