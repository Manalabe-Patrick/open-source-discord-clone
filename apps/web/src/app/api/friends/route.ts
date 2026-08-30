import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

const userSelect = { id: true, name: true, image: true, status: true } as const

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const accepted = await prisma.friendRequest.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    include: { requester: { select: userSelect }, addressee: { select: userSelect } },
  })
  const friends = accepted.map((request) => (request.requesterId === userId ? request.addressee : request.requester))

  const incoming = await prisma.friendRequest.findMany({
    where: { status: 'PENDING', addresseeId: userId },
    include: { requester: { select: userSelect } },
  })

  const outgoing = await prisma.friendRequest.findMany({
    where: { status: 'PENDING', requesterId: userId },
    include: { addressee: { select: userSelect } },
  })

  return NextResponse.json(
    {
      friends,
      incoming: incoming.map((r) => ({ id: r.id, requester: r.requester })),
      outgoing: outgoing.map((r) => ({ id: r.id, addressee: r.addressee })),
    },
    { status: 200 }
  )
}
