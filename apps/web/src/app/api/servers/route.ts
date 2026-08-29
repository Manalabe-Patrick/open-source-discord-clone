import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let name: string | undefined
  try {
    ;({ name } = (await request.json()) as { name?: string })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!name) {
    return NextResponse.json({ error: 'Server name is required' }, { status: 400 })
  }

  const server = await prisma.server.create({
    data: {
      name,
      ownerId: session.user.id,
      memberships: {
        create: { userId: session.user.id, role: 'OWNER' },
      },
    },
  })

  return NextResponse.json(server, { status: 201 })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const servers = await prisma.server.findMany({
    where: { memberships: { some: { userId: session.user.id } } },
    include: { channels: true },
  })

  return NextResponse.json(servers, { status: 200 })
}
