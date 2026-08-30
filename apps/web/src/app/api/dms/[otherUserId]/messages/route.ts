import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

export async function GET(_request: Request, { params }: { params: Promise<{ otherUserId: string }> }) {
  const { otherUserId } = await params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const conversation = await prisma.dmConversation.findFirst({
    where: {
      AND: [
        { participants: { some: { userId: session.user.id } } },
        { participants: { some: { userId: otherUserId } } },
      ],
    },
  })

  if (!conversation) {
    return NextResponse.json([], { status: 200 })
  }

  const messages = await prisma.message.findMany({
    where: { dmConversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, name: true, image: true } } },
  })

  const payload = messages.map((message) => ({
    id: message.id,
    content: message.content,
    dmConversationId: message.dmConversationId,
    createdAt: message.createdAt.toISOString(),
    attachmentUrl: message.attachmentUrl,
    author: message.author,
  }))

  return NextResponse.json(payload, { status: 200 })
}
