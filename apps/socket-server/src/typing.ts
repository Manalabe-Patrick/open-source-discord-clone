import type { TypedServer, TypedSocket } from './types.js'
import { channelRoom } from './channels.js'
import { safeHandler } from './safeHandler.js'

export function registerTypingHandlers(_io: TypedServer, socket: TypedSocket) {
  socket.on(
    'typing:start',
    safeHandler(({ channelId }) => {
      if (!socket.rooms.has(channelRoom(channelId))) return
      socket.to(channelRoom(channelId)).emit('typing:start', { channelId, userId: socket.data.userId })
    })
  )

  socket.on(
    'typing:stop',
    safeHandler(({ channelId }) => {
      if (!socket.rooms.has(channelRoom(channelId))) return
      socket.to(channelRoom(channelId)).emit('typing:stop', { channelId, userId: socket.data.userId })
    })
  )
}
