import { prisma } from '@repo/database'
import type { TypedServer, TypedSocket } from './types.js'
import { safeHandler } from './safeHandler.js'

export function registerProfileHandlers(io: TypedServer, socket: TypedSocket) {
  socket.on(
    'profile:updated',
    safeHandler(async () => {
      const user = await prisma.user.findUnique({
        where: { id: socket.data.userId },
        select: { id: true, name: true, image: true, customStatus: true, bio: true },
      })
      if (!user) return

      io.emit('profile:update', {
        userId: user.id,
        name: user.name,
        image: user.image,
        customStatus: user.customStatus,
        bio: user.bio,
      })
    })
  )
}
