import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'

export async function GET(_request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params

  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  const memberships = await prisma.membership.findMany({
    where: { serverId },
    include: { user: { select: { id: true, name: true, image: true, status: true } } },
  })

  const members = memberships.map(({ user, role }) => ({
    id: user.id,
    name: user.name,
    image: user.image,
    role,
    status: user.status,
  }))

  return NextResponse.json(members, { status: 200 })
}
