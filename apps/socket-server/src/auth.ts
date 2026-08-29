import { decode } from 'next-auth/jwt'

const SESSION_COOKIE_NAME = 'authjs.session-token'

function extractCookieValue(cookieHeader: string, name: string): string | null {
  for (const entry of cookieHeader.split(';')) {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex === -1) continue
    const key = entry.slice(0, separatorIndex).trim()
    if (key === name) {
      return decodeURIComponent(entry.slice(separatorIndex + 1).trim())
    }
  }
  return null
}

export async function getUserIdFromCookieHeader(cookieHeader: string | undefined): Promise<string | null> {
  if (!cookieHeader) return null

  // Precedence matches next-auth's own resolution (see node_modules/next-auth/lib/env.js):
  // AUTH_SECRET wins over NEXTAUTH_SECRET. We use `||` instead of `??` so an
  // empty-string value (a common misconfiguration, not "intentionally set") falls
  // through to the other var instead of being treated as a valid secret.
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) return null

  try {
    const token = extractCookieValue(cookieHeader, SESSION_COOKIE_NAME)
    if (!token) return null

    const payload = await decode({ token, secret, salt: SESSION_COOKIE_NAME })
    const userId = payload?.id
    return typeof userId === 'string' ? userId : null
  } catch {
    return null
  }
}
