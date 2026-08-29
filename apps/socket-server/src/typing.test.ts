import { describe, it, expect, vi } from 'vitest'
import { registerTypingHandlers } from './typing'
import type { TypedServer, TypedSocket } from './types'

function createFakeSocket(rooms: Set<string>) {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const toEmit = vi.fn()

  const socket = {
    data: { userId: 'user-1' },
    rooms,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    },
    to: vi.fn(() => ({ emit: toEmit })),
  }

  return { socket: socket as unknown as TypedSocket, handlers, toEmit }
}

// registerTypingHandlers wraps each handler in safeHandler, which defers the
// actual call via Promise.resolve().then(...). Flush the microtask queue
// after invoking a handler before asserting on its side effects.
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('registerTypingHandlers', () => {
  it('does not broadcast typing:start for a channel the socket never joined', async () => {
    const { socket, handlers, toEmit } = createFakeSocket(new Set())
    registerTypingHandlers({} as TypedServer, socket)

    handlers.get('typing:start')?.({ channelId: 'channel-1' })
    await flushMicrotasks()

    expect(socket.to).not.toHaveBeenCalled()
    expect(toEmit).not.toHaveBeenCalled()
  })

  it('broadcasts typing:start for a channel the socket has joined', async () => {
    const { socket, handlers, toEmit } = createFakeSocket(new Set(['channel:channel-1']))
    registerTypingHandlers({} as TypedServer, socket)

    handlers.get('typing:start')?.({ channelId: 'channel-1' })
    await flushMicrotasks()

    expect(socket.to).toHaveBeenCalledWith('channel:channel-1')
    expect(toEmit).toHaveBeenCalledWith('typing:start', { channelId: 'channel-1', userId: 'user-1' })
  })

  it('does not broadcast typing:stop for a channel the socket never joined', async () => {
    const { socket, handlers, toEmit } = createFakeSocket(new Set())
    registerTypingHandlers({} as TypedServer, socket)

    handlers.get('typing:stop')?.({ channelId: 'channel-1' })
    await flushMicrotasks()

    expect(socket.to).not.toHaveBeenCalled()
    expect(toEmit).not.toHaveBeenCalled()
  })
})
