import { describe, it, expect } from 'vitest'
import { createRateLimiter } from './rateLimit'

describe('createRateLimiter', () => {
  it('allows requests up to the limit', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 })

    expect(limiter.consume('a')).toBe(true)
    expect(limiter.consume('a')).toBe(true)
    expect(limiter.consume('a')).toBe(true)
  })

  it('rejects requests once the limit is exceeded within the window', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 })

    expect(limiter.consume('a')).toBe(true)
    expect(limiter.consume('a')).toBe(true)
    expect(limiter.consume('a')).toBe(false)
  })

  it('tracks keys independently', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 })

    expect(limiter.consume('a')).toBe(true)
    expect(limiter.consume('b')).toBe(true)
    expect(limiter.consume('a')).toBe(false)
    expect(limiter.consume('b')).toBe(false)
  })

  it('allows requests again once the window has passed', () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now })

    expect(limiter.consume('a')).toBe(true)
    expect(limiter.consume('a')).toBe(false)

    now = 1001
    expect(limiter.consume('a')).toBe(true)
  })

  it('reset() clears all tracked keys', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 })

    expect(limiter.consume('a')).toBe(true)
    expect(limiter.consume('a')).toBe(false)

    limiter.reset()
    expect(limiter.consume('a')).toBe(true)
  })
})
