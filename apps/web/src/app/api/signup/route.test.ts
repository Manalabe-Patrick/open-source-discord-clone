import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@repo/database'
import { POST } from './route'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/signup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/signup', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: 'newuser@example.com' } })
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'newuser@example.com' } })
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
})
