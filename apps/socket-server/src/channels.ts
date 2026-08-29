import type { TypedServer, TypedSocket } from './types.js'
import { getServerMembership } from './membership.js'
import { safeHandler } from './safeHandler.js'

function channelRoom(channelId: string): string {
  return `channel:${channelId}`
}

export function registerChannelHandlers(_io: TypedServer, socket: TypedSocket) {
  socket.on(
    'channel:join',
    safeHandler(async ({ channelId }, ack) => {
      const membership = await getServerMembership(socket.data.userId, channelId)
      if (!membership) {
        ack({ ok: false, error: 'Not a member of this channel\'s server' })
        return
      }

      socket.join(channelRoom(channelId))
      ack({ ok: true })
    })
  )

  socket.on(
    'channel:leave',
    safeHandler(({ channelId }) => {
      socket.leave(channelRoom(channelId))
    })
  )
}

export { channelRoom }
