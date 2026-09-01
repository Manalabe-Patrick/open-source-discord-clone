import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@repo/database'
import { POST, resetSignupRateLimit } from './route'

function makeRequest(body: unknown, ip = '10.0.0.1') {
  return new Request('http://localhost/api/signup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
  })
}

describe('POST /api/signup', () => {
  beforeEach(async () => {
    resetSignupRateLimit()
    await prisma.user.deleteMany({ where: { email: 'newuser@example.com' } })
    await prisma.user.deleteMany({ where: { email: { startsWith: 'ratelimit-' } } })
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'newuser@example.com' } })
    await prisma.user.deleteMany({ where: { email: { startsWith: 'ratelimit-' } } })
  })

  it('returns 400 for a malformed request body', async () => {
    const response = await POST(new Request('http://localhost/api/signup', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(response.status).toBe(400)
  })

  it('normalizes email to lowercase on signup', async () => {
    const response = await POST(makeRequest({
      email: 'NewUser@Example.com',
      password: 'password123',
      name: 'New User',
    }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.email).toBe('newuser@example.com')
  })

  it('treats emails differing only by case as duplicates', async () => {
    await POST(makeRequest({ email: 'NewUser@Example.com', password: 'password123', name: 'First' }))
    const response = await POST(makeRequest({ email: 'newuser@example.com', password: 'password123', name: 'Second' }))
    expect(response.status).toBe(400)
  })

  it('creates a user with valid input', async () => {
    const response = await POST(makeRequest({
      email: 'newuser@example.com',
      password: 'password123',
      name: 'New User',
    }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.email).toBe('newuser@example.com')
    expect(body.name).toBe('New User')
    expect(body.passwordHash).toBeUndefined()
  })

  it('rejects a password under 8 characters', async () => {
    const response = await POST(makeRequest({
      email: 'newuser@example.com',
      password: 'short',
      name: 'New User',
    }))
    expect(response.status).toBe(400)
  })

  it('rejects a duplicate email', async () => {
    await POST(makeRequest({ email: 'newuser@example.com', password: 'password123', name: 'First' }))
    const response = await POST(makeRequest({ email: 'newuser@example.com', password: 'password123', name: 'Second' }))
    expect(response.status).toBe(400)
  })

  it('rate limits repeated signup attempts from the same IP', async () => {
    for (let i = 0; i < 5; i++) {
      const response = await POST(makeRequest({
        email: `ratelimit-${i}@example.com`,
        password: 'password123',
        name: 'Rate Limit Test',
      }, '9.9.9.9'))
      expect(response.status).toBe(201)
    }

    const limited = await POST(makeRequest({
      email: 'ratelimit-overflow@example.com',
      password: 'password123',
      name: 'Rate Limit Test',
    }, '9.9.9.9'))
    expect(limited.status).toBe(429)
  })

  it('does not rate limit signups from a different IP', async () => {
    for (let i = 0; i < 5; i++) {
      await POST(makeRequest({ email: `ratelimit-a${i}@example.com`, password: 'password123', name: 'Test' }, '1.1.1.1'))
    }
    const response = await POST(makeRequest({ email: 'ratelimit-b0@example.com', password: 'password123', name: 'Test' }, '2.2.2.2'))
    expect(response.status).toBe(201)
  })
})
