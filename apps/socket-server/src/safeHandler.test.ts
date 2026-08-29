import { describe, it, expect, vi } from 'vitest'
import { safeHandler } from './safeHandler'

describe('safeHandler', () => {
  it('calls the ack with a failure response when the wrapped handler throws synchronously', async () => {
    const ack = vi.fn()
    const handler = safeHandler((_payload: unknown, ack: (response: unknown) => void) => {
      throw new Error('boom')
    })

    handler(undefined, ack)
    await new Promise((resolve) => setImmediate(resolve))

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'Internal server error' })
  })

  it('calls the ack with a failure response when the wrapped handler rejects asynchronously', async () => {
    const ack = vi.fn()
    const handler = safeHandler(async (_payload: unknown, ack: (response: unknown) => void) => {
      throw new Error('async boom')
    })

    handler(undefined, ack)
    await new Promise((resolve) => setImmediate(resolve))

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'Internal server error' })
  })

  it('does not throw when the wrapped handler has no ack callback and errors', async () => {
    const handler = safeHandler((_payload: unknown) => {
      throw new Error('no ack here')
    })

    expect(() => handler(undefined)).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('calls through normally when the wrapped handler succeeds', async () => {
    const ack = vi.fn()
    const handler = safeHandler((payload: { value: number }, ack: (response: unknown) => void) => {
      ack({ ok: true, doubled: payload.value * 2 })
    })

    handler({ value: 21 }, ack)
    await new Promise((resolve) => setImmediate(resolve))

    expect(ack).toHaveBeenCalledWith({ ok: true, doubled: 42 })
  })

  it('double-acks with a failure response if the handler already called ack before throwing (pre-existing behavior; socket.io itself no-ops the redundant second ack, so this is harmless)', async () => {
    const ack = vi.fn()
    const handler = safeHandler((_payload: unknown, ack: (response: unknown) => void) => {
      ack({ ok: true })
      throw new Error('thrown after ack')
    })

    handler(undefined, ack)
    await new Promise((resolve) => setImmediate(resolve))

    expect(ack).toHaveBeenCalledTimes(2)
    expect(ack).toHaveBeenNthCalledWith(1, { ok: true })
    expect(ack).toHaveBeenNthCalledWith(2, { ok: false, error: 'Internal server error' })
  })
})
