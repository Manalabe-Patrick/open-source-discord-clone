import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from '@repo/database'
import { authConfig } from './auth.config'
import { authorizeCredentials } from './credentials'
import { markEmailVerifiedForGoogleUser } from './accountLinking'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      // Google verifies account emails, so it's safe to let a Google sign-in
      // claim an existing user record by email — this is what lets someone
      // reclaim their address via Google even if another account (e.g. a
      // credentials signup) was created against it first. See
      // markEmailVerifiedOnTrustedLink below for the corresponding
      // emailVerified stamp once that link happens.
      allowDangerousEmailAccountLinking: true,
    }),
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: authorizeCredentials,
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account, profile }) {
      if (account?.provider === 'google' && profile?.email_verified === true && profile.email) {
        await markEmailVerifiedForGoogleUser(profile.email)
      }
      return true
    },
    async jwt({ token, user, trigger, session }) {
      if (user) token.id = user.id
      if (trigger === 'update' && session) {
        if (session.name !== undefined) token.name = session.name
        if (session.image !== undefined) token.picture = session.image
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.id as string
      return session
    },
  },
})
