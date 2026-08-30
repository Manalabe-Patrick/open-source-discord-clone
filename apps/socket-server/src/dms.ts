import { prisma } from '@repo/database'
import type { DmConversation } from '@repo/database'
import type { DMMessagePayload, TypedServer, TypedSocket } from './types.js'
import { safeHandler } from './safeHandler.js'

export function dmRoom(userIdA: string, userIdB: string): string {
  return `dm:${[userIdA, userIdB].sort().join(':')}`
}

export async function findDMConversation(userIdA: string, userIdB: string): Promise<DmConversation | null> {
  return prisma.dmConversation.findFirst({
    where: {
      AND: [
        { participants: { some: { userId: userIdA } } },
        { participants: { some: { userId: userIdB } } },
      ],
    },
  })
}

export async function getOrCreateDMConversation(userIdA: string, userIdB: string): Promise<DmConversation> {
  const existing = await findDMConversation(userIdA, userIdB)
  if (existing) return existing

  return prisma.dmConversation.create({
    data: {
      participants: {
        create: [{ userId: userIdA }, { userId: userIdB }],
      },
    },
  })
}

export function registerDMHandlers(io: TypedServer, socket: TypedSocket) {
  socket.on(
    'dm:join',
    safeHandler(async ({ otherUserId }, ack) => {
      if (otherUserId === socket.data.userId) {
        ack({ ok: false, error: 'Cannot open a DM with yourself' })
        return
      }

      const otherUser = await prisma.user.findUnique({ where: { id: otherUserId } })
      if (!otherUser) {
        ack({ ok: false, error: 'User not found' })
        return
      }

      socket.join(dmRoom(socket.data.userId, otherUserId))
      ack({ ok: true })
    })
  )

  socket.on(
    'dm:leave',
    safeHandler(({ otherUserId }) => {
      socket.leave(dmRoom(socket.data.userId, otherUserId))
    })
  )

  socket.on(
    'dm:message:new',
    safeHandler(async ({ recipientUserId, content }, ack) => {
      if (recipientUserId === socket.data.userId) {
        ack({ ok: false, error: 'Cannot message yourself' })
        return
      }

      const recipient = await prisma.user.findUnique({ where: { id: recipientUserId } })
      if (!recipient) {
        ack({ ok: false, error: 'User not found' })
        return
      }

      const trimmed = content.trim()
      if (!trimmed) {
        ack({ ok: false, error: 'Message content is required' })
        return
      }

      const conversation = await getOrCreateDMConversation(socket.data.userId, recipientUserId)

      const message = await prisma.message.create({
        data: { content: trimmed, dmConversationId: conversation.id, authorId: socket.data.userId },
        include: { author: { select: { id: true, name: true, image: true } } },
      })

      const payload: DMMessagePayload = {
        id: message.id,
        content: message.content,
        dmConversationId: conversation.id,
        createdAt: message.createdAt.toISOString(),
        author: message.author,
      }

      io.to(dmRoom(socket.data.userId, recipientUserId)).emit('dm:message:new', payload)
      ack({ ok: true })
    })
  )

  socket.on(
    'dm:message:delete',
    safeHandler(async ({ dmConversationId, messageId }, ack) => {
      const message = await prisma.message.findFirst({ where: { id: messageId, dmConversationId } })
      if (!message) {
        ack({ ok: false, error: 'Message not found' })
        return
      }

      if (message.authorId !== socket.data.userId) {
        ack({ ok: false, error: 'You can only delete your own messages' })
        return
      }

      const participant = await prisma.dmParticipant.findUnique({
        where: { userId_dmConversationId: { userId: socket.data.userId, dmConversationId } },
      })
      if (!participant) {
        ack({ ok: false, error: 'Not a participant in this conversation' })
        return
      }

      await prisma.message.delete({ where: { id: messageId } })

      const otherParticipant = await prisma.dmParticipant.findFirst({
        where: { dmConversationId, userId: { not: socket.data.userId } },
      })
      if (otherParticipant) {
        io.to(dmRoom(socket.data.userId, otherParticipant.userId)).emit('dm:message:delete', { dmConversationId, messageId })
      }
      ack({ ok: true })
    })
  )
}
