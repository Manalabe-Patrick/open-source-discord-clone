import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@repo/database'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { email: rawEmail, password, name } = body as { email?: string; password?: string; name?: string }
  const email = rawEmail?.trim().toLowerCase()

  if (!email || !password || !name) {
    return NextResponse.json({ error: 'Email, password, and name are required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'An account with that email already exists' }, { status: 400 })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: { email, name, passwordHash },
    select: { id: true, email: true, name: true },
  })

  return NextResponse.json(user, { status: 201 })
}
