import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@repo/database'
import { createRateLimiter } from '@/lib/rateLimit'

const signupRateLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 })

export function resetSignupRateLimit(): void {
  signupRateLimiter.reset()
}

function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

export async function POST(request: Request) {
  if (!signupRateLimiter.consume(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many signup attempts. Try again later.' }, { status: 429 })
  }

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
