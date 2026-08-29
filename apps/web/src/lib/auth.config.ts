import type { NextAuthConfig } from 'next-auth'

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isPublicRoute =
        nextUrl.pathname === '/login' ||
        nextUrl.pathname === '/signup' ||
        nextUrl.pathname.startsWith('/api/auth') ||
        nextUrl.pathname.startsWith('/api/signup')

      if (isPublicRoute) return true
      return isLoggedIn
    },
  },
} satisfies NextAuthConfig
