import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { encode } from 'next-auth/jwt'
import { getUserIdFromCookieHeader } from './auth'

const TEST_SECRET = 'test-secret-for-jwt-round-trip-only'
const SESSION_COOKIE_NAME = 'authjs.session-token'

describe('getUserIdFromCookieHeader', () => {
  const originalSecret = process.env.NEXTAUTH_SECRET

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = TEST_SECRET
  })

  afterEach(() => {
    process.env.NEXTAUTH_SECRET = originalSecret
  })

  it('extracts the user id from a validly encoded session cookie', async () => {
    const token = await encode({
      secret: TEST_SECRET,
      salt: SESSION_COOKIE_NAME,
      token: { id: 'user-123', email: 'a@example.com' },
    })

    const result = await getUserIdFromCookieHeader(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`)

    expect(result).toBe('user-123')
  })

  it('finds the session cookie among other cookies', async () => {
    const token = await encode({
      secret: TEST_SECRET,
      salt: SESSION_COOKIE_NAME,
      token: { id: 'user-456' },
    })

    const result = await getUserIdFromCookieHeader(`other=1; ${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; another=2`)

    expect(result).toBe('user-456')
  })

  it('returns null when no cookie header is present', async () => {
    const result = await getUserIdFromCookieHeader(undefined)
    expect(result).toBeNull()
  })

  it('returns null when the session cookie is missing from the header', async () => {
    const result = await getUserIdFromCookieHeader('other-cookie=value')
    expect(result).toBeNull()
  })

  it('returns null when the token cannot be decrypted (wrong secret)', async () => {
    const token = await encode({
      secret: 'a-completely-different-secret',
      salt: SESSION_COOKIE_NAME,
      token: { id: 'user-789' },
    })

    const result = await getUserIdFromCookieHeader(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`)

    expect(result).toBeNull()
  })

  it('returns null when NEXTAUTH_SECRET is not set', async () => {
    process.env.NEXTAUTH_SECRET = ''
    const token = await encode({ secret: TEST_SECRET, salt: SESSION_COOKIE_NAME, token: { id: 'user-1' } })

    const result = await getUserIdFromCookieHeader(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`)

    expect(result).toBeNull()
  })

  it('returns null (does not throw/reject) when the session cookie value is malformed percent-encoding', async () => {
    await expect(getUserIdFromCookieHeader(`${SESSION_COOKIE_NAME}=%zz`)).resolves.toBeNull()
  })
})
