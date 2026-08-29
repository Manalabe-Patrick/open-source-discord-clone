import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

export async function POST(_request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const server = await prisma.server.findUnique({ where: { id: serverId } })
  if (!server) {
    return NextResponse.json({ error: 'Server not found' }, { status: 404 })
  }

  await prisma.membership.upsert({
    where: { userId_serverId: { userId: session.user.id, serverId } },
    update: {},
    create: { userId: session.user.id, serverId, role: 'MEMBER' },
  })

  return NextResponse.json({ joined: true }, { status: 200 })
}
