import { prisma } from '@repo/database'

// Google is allowed to auto-link to an existing (e.g. credentials) account
// with the same email (see GoogleProvider's allowDangerousEmailAccountLinking
// in auth.ts), so a real owner can always reclaim their email via Google even
// if someone else registered a credentials account against it first. Once
// Google reports that email as verified, stamp it here so the account no
// longer looks unverified to the rest of the app.
export async function markEmailVerifiedForGoogleUser(email: string): Promise<void> {
  await prisma.user.updateMany({
    where: { email, emailVerified: null },
    data: { emailVerified: new Date() },
  })
}
