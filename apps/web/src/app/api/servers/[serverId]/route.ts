import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'

export async function DELETE(_request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params
  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  if (result.membership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only the server owner can delete the server' }, { status: 403 })
  }

  await prisma.server.delete({ where: { id: serverId } })

  return NextResponse.json({ deleted: true }, { status: 200 })
}
