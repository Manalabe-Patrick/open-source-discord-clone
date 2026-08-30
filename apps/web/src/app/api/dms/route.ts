import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const conversations = await prisma.dmConversation.findMany({
    where: { participants: { some: { userId: session.user.id } } },
    include: {
      participants: {
        where: { userId: { not: session.user.id } },
        include: { user: { select: { id: true, name: true, image: true, status: true } } },
      },
    },
  })

  const payload = conversations
    .filter((conversation) => conversation.participants.length > 0)
    .map((conversation) => ({
      id: conversation.id,
      otherUser: conversation.participants[0].user,
    }))

  return NextResponse.json(payload, { status: 200 })
}
