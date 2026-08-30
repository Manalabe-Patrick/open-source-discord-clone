import { prisma, Prisma } from '@repo/database'
import type { DmConversation } from '@repo/database'
import type { DMMessagePayload, TypedServer, TypedSocket } from './types.js'
import { safeHandler } from './safeHandler.js'
import { isValidAttachmentUrl } from './attachments.js'

// Two near-simultaneous first-ever messages between the same pair of users
// used to be able to race a read-then-create pattern into creating two
// separate DmConversation rows for the same pair, permanently splitting
// their message history. pairKey is a unique, order-independent key derived
// from both user ids, so lookup/creation can go through a single atomic
// upsert instead.
function pairKey(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join(':')
}

export function dmRoom(userIdA: string, userIdB: string): string {
  return `dm:${pairKey(userIdA, userIdB)}`
}

export async function findDMConversation(userIdA: string, userIdB: string): Promise<DmConversation | null> {
  return prisma.dmConversation.findUnique({ where: { pairKey: pairKey(userIdA, userIdB) } })
}

export async function getOrCreateDMConversation(userIdA: string, userIdB: string): Promise<DmConversation> {
  const key = pairKey(userIdA, userIdB)
  try {
    return await prisma.dmConversation.upsert({
      where: { pairKey: key },
      update: {},
      create: {
        pairKey: key,
        participants: { create: [{ userId: userIdA }, { userId: userIdB }] },
      },
    })
  } catch (error) {
    // upsert's `create` branch nests a participants write, which Prisma can't
    // compile to a single native INSERT ... ON CONFLICT — it falls back to a
    // find-then-create, so a genuine concurrent race can still lose here.
    // The unique index on pairKey means that race raises P2002 rather than
    // creating a duplicate row (the original bug this replaced), so on P2002
    // the winner's row is already committed — just look it up instead of
    // surfacing the race as an error to the caller who lost it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.dmConversation.findUnique({ where: { pairKey: key } })
      if (existing) return existing
    }
    throw error
  }
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
    safeHandler(async ({ recipientUserId, content, attachmentUrl }, ack) => {
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
      if (!trimmed && !attachmentUrl) {
        ack({ ok: false, error: 'Message content or an attachment is required' })
        return
      }
      if (attachmentUrl && !isValidAttachmentUrl(attachmentUrl)) {
        ack({ ok: false, error: 'Invalid attachment URL' })
        return
      }

      const conversation = await getOrCreateDMConversation(socket.data.userId, recipientUserId)

      const message = await prisma.message.create({
        data: { content: trimmed, dmConversationId: conversation.id, authorId: socket.data.userId, attachmentUrl: attachmentUrl ?? null },
        include: { author: { select: { id: true, name: true, image: true } } },
      })

      const payload: DMMessagePayload = {
        id: message.id,
        content: message.content,
        dmConversationId: conversation.id,
        createdAt: message.createdAt.toISOString(),
        attachmentUrl: message.attachmentUrl,
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
