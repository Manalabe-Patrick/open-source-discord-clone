import { prisma } from '@repo/database'
import { canDeleteMessage } from '@repo/permissions'
import type { TypedServer, TypedSocket, MessagePayload } from './types.js'
import { getServerMembership } from './membership.js'
import { channelRoom } from './channels.js'
import { safeHandler } from './safeHandler.js'
import { isValidAttachmentUrl } from './attachments.js'

export function registerMessageHandlers(io: TypedServer, socket: TypedSocket) {
  socket.on(
    'message:new',
    safeHandler(async ({ channelId, content, attachmentUrl }, ack) => {
      const membership = await getServerMembership(socket.data.userId, channelId)
      if (!membership) {
        ack({ ok: false, error: 'Not a member of this channel\'s server' })
        return
      }

      const trimmed = content.trim()
      if (!trimmed && !attachmentUrl) {
        ack({ ok: false, error: 'Message content or an attachment is required' })
        return
      }
      if (attachmentUrl && !isValidAttachmentUrl(attachmentUrl)) {
        ack({ ok: false, error: 'Invalid attachment URL' })
        return
      }

      const message = await prisma.message.create({
        data: { content: trimmed, channelId, authorId: socket.data.userId, attachmentUrl: attachmentUrl ?? null },
        include: { author: { select: { id: true, name: true, image: true } } },
      })

      const payload: MessagePayload = {
        id: message.id,
        content: message.content,
        channelId,
        createdAt: message.createdAt.toISOString(),
        attachmentUrl: message.attachmentUrl,
        author: message.author,
      }

      io.to(channelRoom(channelId)).emit('message:new', payload)
      ack({ ok: true })
    })
  )

  socket.on(
    'message:delete',
    safeHandler(async ({ channelId, messageId }, ack) => {
      const membership = await getServerMembership(socket.data.userId, channelId)
      if (!membership) {
        ack({ ok: false, error: 'Not a member of this channel\'s server' })
        return
      }

      const message = await prisma.message.findFirst({ where: { id: messageId, channelId } })
      if (!message) {
        ack({ ok: false, error: 'Message not found' })
        return
      }

      const isOwnMessage = message.authorId === socket.data.userId
      if (!canDeleteMessage(membership.role, isOwnMessage)) {
        ack({ ok: false, error: 'Insufficient permissions' })
        return
      }

      await prisma.message.delete({ where: { id: messageId } })

      io.to(channelRoom(channelId)).emit('message:delete', { channelId, messageId })
      ack({ ok: true })
    })
  )
}
