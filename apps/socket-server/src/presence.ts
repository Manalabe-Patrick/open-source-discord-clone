import { prisma } from '@repo/database'
import type { TypedServer, TypedSocket, PresenceStatus } from './types.js'
import { safeHandler } from './safeHandler.js'

const OFFLINE_GRACE_PERIOD_MS = 10_000

// Tracks pending "mark offline" timers per user, so a quick reconnect (page
// refresh, brief network blip) cancels the pending offline transition instead
// of flickering the user's status to everyone.
const pendingOfflineTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function setStatus(io: TypedServer, userId: string, status: PresenceStatus) {
  try {
    await prisma.user.update({ where: { id: userId }, data: { status } })
    io.emit('presence:update', { userId, status })
  } catch (error) {
    console.error(`Failed to update presence for user ${userId} to ${status}:`, error)
  }
}

export function registerPresenceHandlers(io: TypedServer, socket: TypedSocket) {
  const { userId } = socket.data

  const pendingTimer = pendingOfflineTimers.get(userId)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingOfflineTimers.delete(userId)
  }
  setStatus(io, userId, 'ONLINE')

  socket.on(
    'disconnect',
    safeHandler(() => {
      const timer = setTimeout(() => {
        pendingOfflineTimers.delete(userId)
        setStatus(io, userId, 'OFFLINE')
      }, OFFLINE_GRACE_PERIOD_MS)
      pendingOfflineTimers.set(userId, timer)
    })
  )

  socket.on(
    'presence:idle',
    safeHandler(() => {
      setStatus(io, userId, 'IDLE')
    })
  )

  socket.on(
    'presence:active',
    safeHandler(() => {
      setStatus(io, userId, 'ONLINE')
    })
  )
}
