import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma, type Membership } from '@repo/database'

type RequireMembershipResult = { userId: string; membership: Membership } | { error: NextResponse }

export async function requireMembership(serverId: string): Promise<RequireMembershipResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_serverId: { userId: session.user.id, serverId } },
  })
  if (!membership) {
    return { error: NextResponse.json({ error: 'Not a member of this server' }, { status: 403 }) }
  }

  return { userId: session.user.id, membership }
}
