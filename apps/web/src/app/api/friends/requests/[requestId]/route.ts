import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

export async function PATCH(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let action: string | undefined
  try {
    ;({ action } = (await request.json()) as { action?: string })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (action !== 'accept' && action !== 'decline') {
    return NextResponse.json({ error: 'action must be "accept" or "decline"' }, { status: 400 })
  }

  const friendRequest = await prisma.friendRequest.findUnique({ where: { id: requestId } })
  if (!friendRequest) {
    return NextResponse.json({ error: 'Friend request not found' }, { status: 404 })
  }

  if (friendRequest.addresseeId !== session.user.id) {
    return NextResponse.json({ error: 'Only the addressee can respond to this request' }, { status: 403 })
  }

  if (friendRequest.status !== 'PENDING') {
    return NextResponse.json({ error: 'This request has already been resolved' }, { status: 400 })
  }

  const updated = await prisma.friendRequest.update({
    where: { id: requestId },
    data: { status: action === 'accept' ? 'ACCEPTED' : 'DECLINED' },
  })

  return NextResponse.json(updated, { status: 200 })
}
