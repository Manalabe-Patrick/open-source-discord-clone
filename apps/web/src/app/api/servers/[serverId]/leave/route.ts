import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'

export async function POST(_request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params
  const result = await requireMembership(serverId)
  if ('error' in result) return result.error
  const { userId, membership } = result

  if (membership.role === 'OWNER') {
    return NextResponse.json(
      { error: 'The server owner cannot leave. Delete the server or transfer ownership first.' },
      { status: 403 }
    )
  }

  await prisma.membership.deleteMany({
    where: { userId, serverId },
  })

  return NextResponse.json({ left: true }, { status: 200 })
}
