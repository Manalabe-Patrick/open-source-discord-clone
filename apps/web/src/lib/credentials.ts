import bcrypt from 'bcryptjs'
import { prisma } from '@repo/database'

export async function authorizeCredentials(credentials: Partial<Record<'email' | 'password', unknown>> | undefined) {
  if (!credentials?.email || !credentials?.password) return null

  const email = (credentials.email as string).trim().toLowerCase()
  const user = await prisma.user.findUnique({
    where: { email },
  })
  if (!user || !user.passwordHash) return null

  const isValid = await bcrypt.compare(credentials.password as string, user.passwordHash)
  if (!isValid) return null

  return { id: user.id, email: user.email, name: user.name, image: user.image }
}
