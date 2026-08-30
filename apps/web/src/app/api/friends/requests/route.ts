import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let email: string | undefined
  try {
    ;({ email } = (await request.json()) as { email?: string })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const addressee = await prisma.user.findUnique({ where: { email } })
  if (!addressee) {
    return NextResponse.json({ error: 'No user found with that email' }, { status: 400 })
  }
  if (addressee.id === session.user.id) {
    return NextResponse.json({ error: 'Cannot send a friend request to yourself' }, { status: 400 })
  }

  const existing = await prisma.friendRequest.findFirst({
    where: {
      OR: [
        { requesterId: session.user.id, addresseeId: addressee.id },
        { requesterId: addressee.id, addresseeId: session.user.id },
      ],
    },
  })
  if (existing) {
    return NextResponse.json({ error: 'A friend request already exists between you and this user' }, { status: 400 })
  }

  const friendRequest = await prisma.friendRequest.create({
    data: { requesterId: session.user.id, addresseeId: addressee.id },
  })

  return NextResponse.json(friendRequest, { status: 201 })
}
