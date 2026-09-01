import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

const NAME_MIN_LENGTH = 2
const NAME_MAX_LENGTH = 32
const CUSTOM_STATUS_MAX_LENGTH = 128
const BIO_MAX_LENGTH = 190

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { name, customStatus, bio } = body as { name?: string; customStatus?: string | null; bio?: string | null }

  const data: { name?: string; customStatus?: string | null; bio?: string | null } = {}

  if (name !== undefined) {
    const trimmed = name.trim()
    if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
      return NextResponse.json({ error: `Username must be between ${NAME_MIN_LENGTH} and ${NAME_MAX_LENGTH} characters` }, { status: 400 })
    }
    data.name = trimmed
  }

  if (customStatus !== undefined) {
    const trimmed = customStatus?.trim() ?? ''
    if (trimmed.length > CUSTOM_STATUS_MAX_LENGTH) {
      return NextResponse.json({ error: `Custom status must be ${CUSTOM_STATUS_MAX_LENGTH} characters or fewer` }, { status: 400 })
    }
    data.customStatus = trimmed || null
  }

  if (bio !== undefined) {
    const trimmed = bio?.trim() ?? ''
    if (trimmed.length > BIO_MAX_LENGTH) {
      return NextResponse.json({ error: `Bio must be ${BIO_MAX_LENGTH} characters or fewer` }, { status: 400 })
    }
    data.bio = trimmed || null
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { id: true, name: true, image: true, customStatus: true, bio: true, status: true, createdAt: true },
  })

  return NextResponse.json(user, { status: 200 })
}
